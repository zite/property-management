import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { validateSettings, type SettingsDraft, type SettingsKey } from '../components/settings/rules';
import { parseInput } from '../server/input';

/**
 * Save changes to the organization's settings. The form sends only the fields
 * that changed; every field is re-validated here (Zite does not enforce the
 * input schema), with late-fee fields checked together against what is saved.
 */

const text = (max: number) => z.string().max(max);
const count = z.number().nullable();

const Patch = z
  .object({
    organizationName: text(200),
    legalName: text(200),
    logoUrl: z.string().max(2000).nullable(),
    address: text(400),
    phone: text(60),
    supportEmail: z.string().max(200).nullable(),
    websiteUrl: z.string().max(400).nullable(),
    emergencyPhone: text(60),
    officeHours: text(200),
    currency: text(3),
    timezone: text(80),
    brandColor: text(7),
    rentDueDay: count,
    gracePeriodDays: count,
    lateFeeType: z.enum(['None', 'Flat', 'Percent']),
    lateFeeAmount: count,
    lateFeePercent: count,
    lateFeeMax: count,
    chargeDaysAhead: count,
    rentReminderDays: count,
    renewalNoticeDays: count,
    managementFeePercent: count,
    ownerApprovalThreshold: count,
    applicationFee: count,
    incomeMultiple: count,
    portalHeadline: text(200),
    portalIntro: text(1000),
    paymentInstructions: text(4000),
    onlinePayments: z.boolean(),
    allowPartialPayments: z.boolean(),
    maintenanceRequests: z.boolean(),
    applicationsOpen: z.boolean(),
    emailSignature: text(2000),
    leaseTemplate: z.string().max(120_000),
    defaultRole: z.enum(['Property Manager', 'Leasing Agent', 'Maintenance', 'Accountant']),
  })
  .partial()
  .strict();

const Input = z.object({ patch: Patch });

const LABELS: Record<SettingsKey, string> = {
  organizationName: 'company name', legalName: 'legal name', logoUrl: 'logo', address: 'address', phone: 'office phone', supportEmail: 'support email', websiteUrl: 'website',
  emergencyPhone: 'emergency line', officeHours: 'office hours', currency: 'currency', timezone: 'timezone', brandColor: 'brand colour', rentDueDay: 'rent due day',
  gracePeriodDays: 'grace period', lateFeeType: 'late fee', lateFeeAmount: 'late fee', lateFeePercent: 'late fee', lateFeeMax: 'late fee cap', chargeDaysAhead: 'charge posting',
  rentReminderDays: 'rent reminders', renewalNoticeDays: 'renewal notice', managementFeePercent: 'management fee', ownerApprovalThreshold: 'owner approval limit',
  applicationFee: 'application fee', incomeMultiple: 'income multiple', portalHeadline: 'portal headline', portalIntro: 'portal introduction', paymentInstructions: 'payment instructions',
  onlinePayments: 'online payments', allowPartialPayments: 'partial payments', maintenanceRequests: 'maintenance requests', applicationsOpen: 'applications', emailSignature: 'email signature',
  leaseTemplate: 'lease template', defaultRole: 'default role',
};

const LATE_KEYS = ['lateFeeType', 'lateFeeAmount', 'lateFeePercent', 'lateFeeMax'] as const;

export default createEndpoint({
  description: 'Save changes to the organization settings (admins)',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ saved: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    const { patch } = parseInput(Input, input, 'Some of those settings weren’t valid. Reload the page and try again.');
    if ('defaultRole' in patch) assertCan(actor, 'members.manage');

    const current = await getSettings();
    const clean: SettingsDraft = {};
    for (const [key, value] of Object.entries(patch) as Array<[SettingsKey, unknown]>) {
      if (value === undefined) continue;
      (clean as Record<string, unknown>)[key] = typeof value === 'string' && key !== 'leaseTemplate' && key !== 'address' && key !== 'emailSignature' && key !== 'portalIntro' && key !== 'paymentInstructions' ? value.trim() : value;
    }
    if (clean.brandColor) clean.brandColor = clean.brandColor.toLowerCase();
    if (clean.currency) clean.currency = clean.currency.toUpperCase();
    for (const k of ['supportEmail', 'websiteUrl', 'logoUrl'] as const) if (k in clean && !clean[k]) clean[k] = null;

    // Late-fee fields only make sense together, so check the combination that will be saved.
    const check: SettingsDraft = { ...clean };
    if (LATE_KEYS.some(k => k in clean)) for (const k of LATE_KEYS) if (!(k in check)) (check as Record<string, unknown>)[k] = current[k];
    const errors = Object.values(validateSettings(check));
    if (errors.length) throw new ZiteError(errors[0]!, 'BAD_REQUEST');

    const keys = Object.keys(clean) as SettingsKey[];
    if (!keys.length) return { saved: [] };
    const record: Record<string, unknown> = { ...clean };
    // Empty portal copy falls back to the default wording rather than a blank page.
    if (record.portalHeadline === '') record.portalHeadline = null;
    if (record.portalIntro === '') record.portalIntro = null;
    if (record.paymentInstructions === '') record.paymentInstructions = null;
    await withRetry(() => zite.settings.update({ id: current.id, record: record as never }));

    const changed = [...new Set(keys.map(k => LABELS[k]))];
    await logActivity({
      entityType: 'settings',
      entityId: current.id,
      action: 'settings_updated',
      summary: `updated the ${changed.length > 3 ? `${changed.slice(0, 3).join(', ')} and ${changed.length - 3} more settings` : changed.join(', ').replace(/, ([^,]*)$/, ' and $1')}`,
      actorId: actor.id,
      actorName: actor.name,
      data: { fields: keys },
    });
    return { saved: keys };
  },
});
