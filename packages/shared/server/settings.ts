import { zite } from 'zitejs/db';
import type { Role } from '../constants';
import { isDemo } from './demoPreview';
import { bool, iso, num, numOrNull, str } from './sql';

/**
 * The organization: one Settings row, created on first read.
 *
 * Both apps read it — the portal for branding, payment instructions and which
 * features are switched on; the staff app for policies (late fees, due day,
 * reminders), the email signature and currency.
 */

export type LateFeeType = 'None' | 'Flat' | 'Percent';

export type OrgSettings = {
  id: string;
  organizationName: string;
  legalName: string;
  logoUrl: string | null;
  address: string;
  phone: string;
  supportEmail: string | null;
  websiteUrl: string | null;
  emergencyPhone: string;
  officeHours: string;
  currency: string;
  timezone: string;
  brandColor: string;
  rentDueDay: number;
  gracePeriodDays: number;
  lateFeeType: LateFeeType;
  lateFeeAmount: number;
  lateFeePercent: number;
  lateFeeMax: number | null;
  chargeDaysAhead: number;
  rentReminderDays: number;
  renewalNoticeDays: number;
  managementFeePercent: number;
  ownerApprovalThreshold: number | null;
  applicationFee: number;
  incomeMultiple: number;
  portalHeadline: string;
  portalIntro: string;
  paymentInstructions: string;
  onlinePayments: boolean;
  allowPartialPayments: boolean;
  maintenanceRequests: boolean;
  applicationsOpen: boolean;
  emailSignature: string;
  leaseTemplate: string;
  defaultRole: Exclude<Role, 'Admin'>;
  portalUrl: string | null;
  staffAppUrl: string | null;
  seededAt: string | null;
  automationRanAt: string | null;
  automationSummary: string;
};

export const DEFAULT_BRAND = '#0f766e';

export { DEFAULT_LEASE_TEMPLATE, lateFeeFor } from '../settings';
import { DEFAULT_LEASE_TEMPLATE } from '../settings';

export const DEFAULT_SETTINGS = {
  organizationName: 'Your Property Management Company',
  currency: 'USD',
  timezone: 'America/Denver',
  brandColor: DEFAULT_BRAND,
  rentDueDay: 1,
  gracePeriodDays: 5,
  lateFeeType: 'Flat' as LateFeeType,
  lateFeeAmount: 75,
  lateFeePercent: 5,
  chargeDaysAhead: 0,
  rentReminderDays: 3,
  renewalNoticeDays: 60,
  managementFeePercent: 8,
  applicationFee: 45,
  incomeMultiple: 3,
  portalHeadline: 'Welcome home',
  portalIntro: 'Pay rent, request maintenance, sign documents and reach our team — all in one place. Looking for a new home? Browse our available rentals below.',
  paymentInstructions: 'Pay online in the portal, or send a check payable to our office with your unit number in the memo.',
  defaultRole: 'Property Manager' as const,
};

const ROLES_OK = ['Property Manager', 'Leasing Agent', 'Maintenance', 'Accountant'];

export function toSettings(r: Record<string, unknown>): OrgSettings {
  const blank = (v: unknown) => (v == null || v === '' ? null : String(v));
  const lateFeeType = r.lateFeeType === 'None' || r.lateFeeType === 'Percent' || r.lateFeeType === 'Flat' ? (r.lateFeeType as LateFeeType) : DEFAULT_SETTINGS.lateFeeType;
  return {
    id: String(r.id),
    organizationName: str(r.organizationName) || DEFAULT_SETTINGS.organizationName,
    legalName: str(r.legalName) ?? '',
    logoUrl: blank(r.logoUrl),
    address: str(r.address) ?? '',
    phone: str(r.phone) ?? '',
    supportEmail: blank(r.supportEmail),
    websiteUrl: blank(r.websiteUrl),
    emergencyPhone: str(r.emergencyPhone) ?? '',
    officeHours: str(r.officeHours) ?? '',
    currency: /^[A-Z]{3}$/.test(String(r.currency ?? '')) ? String(r.currency) : DEFAULT_SETTINGS.currency,
    timezone: str(r.timezone) || DEFAULT_SETTINGS.timezone,
    brandColor: /^#[0-9a-f]{6}$/i.test(String(r.brandColor ?? '')) ? String(r.brandColor) : DEFAULT_SETTINGS.brandColor,
    rentDueDay: Math.min(28, Math.max(1, num(r.rentDueDay, DEFAULT_SETTINGS.rentDueDay))),
    gracePeriodDays: Math.max(0, num(r.gracePeriodDays, DEFAULT_SETTINGS.gracePeriodDays)),
    lateFeeType,
    lateFeeAmount: num(r.lateFeeAmount, DEFAULT_SETTINGS.lateFeeAmount),
    lateFeePercent: num(r.lateFeePercent, DEFAULT_SETTINGS.lateFeePercent),
    lateFeeMax: numOrNull(r.lateFeeMax),
    chargeDaysAhead: Math.max(0, num(r.chargeDaysAhead, DEFAULT_SETTINGS.chargeDaysAhead)),
    rentReminderDays: Math.max(0, num(r.rentReminderDays, DEFAULT_SETTINGS.rentReminderDays)),
    renewalNoticeDays: Math.max(0, num(r.renewalNoticeDays, DEFAULT_SETTINGS.renewalNoticeDays)),
    managementFeePercent: num(r.managementFeePercent, DEFAULT_SETTINGS.managementFeePercent),
    ownerApprovalThreshold: numOrNull(r.ownerApprovalThreshold),
    applicationFee: num(r.applicationFee, DEFAULT_SETTINGS.applicationFee),
    incomeMultiple: num(r.incomeMultiple, DEFAULT_SETTINGS.incomeMultiple),
    portalHeadline: str(r.portalHeadline) || DEFAULT_SETTINGS.portalHeadline,
    portalIntro: str(r.portalIntro) || DEFAULT_SETTINGS.portalIntro,
    paymentInstructions: str(r.paymentInstructions) || DEFAULT_SETTINGS.paymentInstructions,
    onlinePayments: bool(r.onlinePayments),
    allowPartialPayments: bool(r.allowPartialPayments),
    maintenanceRequests: r.maintenanceRequests == null ? true : bool(r.maintenanceRequests),
    applicationsOpen: r.applicationsOpen == null ? true : bool(r.applicationsOpen),
    emailSignature: str(r.emailSignature) ?? '',
    leaseTemplate: str(r.leaseTemplate) || DEFAULT_LEASE_TEMPLATE,
    defaultRole: (ROLES_OK.includes(String(r.defaultRole)) ? r.defaultRole : DEFAULT_SETTINGS.defaultRole) as OrgSettings['defaultRole'],
    portalUrl: blank(r.portalUrl),
    staffAppUrl: blank(r.staffAppUrl),
    seededAt: iso(r.seededAt),
    automationRanAt: iso(r.automationRanAt),
    automationSummary: str(r.automationSummary) ?? '',
  };
}

const DEFAULT_ROW = {
  organizationName: DEFAULT_SETTINGS.organizationName,
  currency: DEFAULT_SETTINGS.currency,
  timezone: DEFAULT_SETTINGS.timezone,
  brandColor: DEFAULT_SETTINGS.brandColor,
  rentDueDay: DEFAULT_SETTINGS.rentDueDay,
  gracePeriodDays: DEFAULT_SETTINGS.gracePeriodDays,
  lateFeeType: DEFAULT_SETTINGS.lateFeeType,
  lateFeeAmount: DEFAULT_SETTINGS.lateFeeAmount,
  lateFeePercent: DEFAULT_SETTINGS.lateFeePercent,
  chargeDaysAhead: DEFAULT_SETTINGS.chargeDaysAhead,
  rentReminderDays: DEFAULT_SETTINGS.rentReminderDays,
  renewalNoticeDays: DEFAULT_SETTINGS.renewalNoticeDays,
  managementFeePercent: DEFAULT_SETTINGS.managementFeePercent,
  applicationFee: DEFAULT_SETTINGS.applicationFee,
  incomeMultiple: DEFAULT_SETTINGS.incomeMultiple,
  portalHeadline: DEFAULT_SETTINGS.portalHeadline,
  portalIntro: DEFAULT_SETTINGS.portalIntro,
  paymentInstructions: DEFAULT_SETTINGS.paymentInstructions,
  onlinePayments: true,
  allowPartialPayments: true,
  maintenanceRequests: true,
  applicationsOpen: true,
  defaultRole: DEFAULT_SETTINGS.defaultRole,
};

export async function getSettings(): Promise<OrgSettings> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Settings" ORDER BY created_at ASC LIMIT 1`, params: [] });
  if (rows[0]) return toSettings(rows[0]);
  // The demo's database is read-only and refuses the whole request on any write.
  if (isDemo()) return toSettings({ id: '00000000-0000-0000-0000-000000000000', ...DEFAULT_ROW });
  const created = await zite.settings.create({ record: DEFAULT_ROW });
  return toSettings(created as unknown as Record<string, unknown>);
}

/**
 * Each app records its own public URL the first time it runs, so an email sent
 * from one can link people into the other without anyone configuring it.
 */
async function remember(settings: OrgSettings, field: 'portalUrl' | 'staffAppUrl') {
  if (isDemo()) return settings;
  const url = (process.env.ZITE_APP_URL ?? '').replace(/\/+$/, '');
  if (!url || !/^https:\/\//.test(url) || url === settings[field]) return settings;
  // Editor previews run on preview hosts; only replace a known URL with a live one.
  if (/sandbox|preview|editor|localhost/i.test(url) && settings[field]) return settings;
  await zite.settings.update({ id: settings.id, record: { [field]: url } });
  return { ...settings, [field]: url };
}

export const rememberPortalUrl = (s: OrgSettings) => remember(s, 'portalUrl');
export const rememberStaffAppUrl = (s: OrgSettings) => remember(s, 'staffAppUrl');

function link(base: string | null, hashPath: string) {
  if (!base) return '';
  return hashPath ? `${base}/#${hashPath.startsWith('/') ? hashPath : `/${hashPath}`}` : base;
}

export const staffLink = (s: Pick<OrgSettings, 'staffAppUrl'>, hashPath = '') => link(s.staffAppUrl, hashPath);
export const portalLink = (s: Pick<OrgSettings, 'portalUrl'>, hashPath = '') => link(s.portalUrl, hashPath);

/** The late fee a policy charges on a given monthly rent. */

export const isAiConfigured = () => Boolean(process.env.ZITE_ANTHROPIC_ACCESS_TOKEN);
export const isStripeConfigured = () => Boolean(process.env.ZITE_STRIPE_ACCESS_TOKEN);
