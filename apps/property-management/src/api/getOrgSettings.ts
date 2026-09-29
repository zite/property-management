import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { DEFAULT_LEASE_TEMPLATE, getSettings, isAiConfigured, isStripeConfigured } from '@project/shared/server/settings';
import { json, num } from '@project/shared/server/sql';
import { sampleDataState } from '../server/sampleData';

/**
 * Everything Settings needs to edit the organization: every policy and
 * profile field, the lease template's default for "Reset", which
 * integrations this app can see, the last automation run, and whether the
 * workspace holds the demo company or could load it. Admins only.
 */

export const OrgFields = z.object({
  organizationName: z.string(),
  legalName: z.string(),
  logoUrl: z.string().nullable(),
  address: z.string(),
  phone: z.string(),
  supportEmail: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  emergencyPhone: z.string(),
  officeHours: z.string(),
  currency: z.string(),
  timezone: z.string(),
  brandColor: z.string(),
  rentDueDay: z.number(),
  gracePeriodDays: z.number(),
  lateFeeType: z.enum(['None', 'Flat', 'Percent']),
  lateFeeAmount: z.number(),
  lateFeePercent: z.number(),
  lateFeeMax: z.number().nullable(),
  chargeDaysAhead: z.number(),
  rentReminderDays: z.number(),
  renewalNoticeDays: z.number(),
  managementFeePercent: z.number(),
  ownerApprovalThreshold: z.number().nullable(),
  applicationFee: z.number(),
  incomeMultiple: z.number(),
  portalHeadline: z.string(),
  portalIntro: z.string(),
  paymentInstructions: z.string(),
  onlinePayments: z.boolean(),
  allowPartialPayments: z.boolean(),
  maintenanceRequests: z.boolean(),
  applicationsOpen: z.boolean(),
  emailSignature: z.string(),
  leaseTemplate: z.string(),
  defaultRole: z.enum(['Property Manager', 'Leasing Agent', 'Maintenance', 'Accountant']),
});

const Summary = z.object({
  ranAt: z.string(),
  today: z.string(),
  chargesPosted: z.number(),
  lateFees: z.number(),
  rentReminders: z.number(),
  renewalTasks: z.number(),
  moveOutTasks: z.number(),
  workOrdersCreated: z.number(),
  insuranceAlerts: z.number(),
  managementFees: z.number(),
  errors: z.array(z.string()),
});

export default createEndpoint({
  description: 'Load the organization settings for the Settings page (admins)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    settings: OrgFields,
    portalUrl: z.string().nullable(),
    staffAppUrl: z.string().nullable(),
    integrations: z.object({ email: z.boolean(), ai: z.boolean(), stripe: z.boolean() }),
    automation: z.object({ ranAt: z.string().nullable(), summary: Summary.nullable() }),
    demo: z.object({ seededAt: z.string().nullable(), seedStatus: z.string(), canLoad: z.boolean(), resumable: z.boolean() }),
    defaults: z.object({ leaseTemplate: z.string() }),
  }),
  execute: async ({ context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    const s = await getSettings();
    const sample = await sampleDataState(s);
    const raw = json<Record<string, unknown> | null>(s.automationSummary, null);
    const parsed = raw ? Summary.safeParse({ ...raw, errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [] }) : null;
    return {
      settings: {
        organizationName: s.organizationName,
        legalName: s.legalName,
        logoUrl: s.logoUrl,
        address: s.address,
        phone: s.phone,
        supportEmail: s.supportEmail,
        websiteUrl: s.websiteUrl,
        emergencyPhone: s.emergencyPhone,
        officeHours: s.officeHours,
        currency: s.currency,
        timezone: s.timezone,
        brandColor: s.brandColor,
        rentDueDay: s.rentDueDay,
        gracePeriodDays: s.gracePeriodDays,
        lateFeeType: s.lateFeeType,
        lateFeeAmount: s.lateFeeAmount,
        lateFeePercent: s.lateFeePercent,
        lateFeeMax: s.lateFeeMax,
        chargeDaysAhead: s.chargeDaysAhead,
        rentReminderDays: s.rentReminderDays,
        renewalNoticeDays: s.renewalNoticeDays,
        managementFeePercent: s.managementFeePercent,
        ownerApprovalThreshold: s.ownerApprovalThreshold,
        applicationFee: s.applicationFee,
        incomeMultiple: s.incomeMultiple,
        portalHeadline: s.portalHeadline,
        portalIntro: s.portalIntro,
        paymentInstructions: s.paymentInstructions,
        onlinePayments: s.onlinePayments,
        allowPartialPayments: s.allowPartialPayments,
        maintenanceRequests: s.maintenanceRequests,
        applicationsOpen: s.applicationsOpen,
        emailSignature: s.emailSignature,
        leaseTemplate: s.leaseTemplate,
        defaultRole: s.defaultRole,
      },
      portalUrl: s.portalUrl,
      staffAppUrl: s.staffAppUrl,
      integrations: { email: true, ai: isAiConfigured(), stripe: isStripeConfigured() },
      automation: {
        ranAt: s.automationRanAt,
        summary: parsed?.success ? { ...parsed.data, chargesPosted: num(parsed.data.chargesPosted) } : null,
      },
      demo: { seededAt: s.seededAt, seedStatus: sample.status.phase, canLoad: sample.canLoad && actor.role === 'Admin', resumable: sample.resumable && actor.role === 'Admin' },
      defaults: { leaseTemplate: DEFAULT_LEASE_TEMPLATE },
    };
  },
});
