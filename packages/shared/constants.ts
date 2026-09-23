/**
 * Every closed set of values in the app, in one place.
 *
 * These mirror the single-select options in the database exactly — a value
 * written that isn't an option fails at runtime, not at compile time — so
 * endpoints build their zod enums from these arrays and the UI builds its
 * pickers from them. Add an option in the database AND here, together.
 */

export const ROLES = ['Admin', 'Property Manager', 'Leasing Agent', 'Maintenance', 'Accountant'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['Active', 'Invited', 'Deactivated'] as const;

export const OWNER_TYPES = ['Individual', 'Company', 'Trust', 'Partnership'] as const;
export const DISTRIBUTION_METHODS = ['ACH', 'Check', 'Hold'] as const;

export const PROPERTY_TYPES = ['Single-family', 'Multifamily', 'Condo', 'Townhome', 'Commercial', 'Mixed-use'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_STATUSES = ['Active', 'Inactive', 'Archived'] as const;

export const UNIT_READINESS = ['Ready', 'Make ready', 'Down', 'Off market'] as const;
export type UnitReadiness = (typeof UNIT_READINESS)[number];

/** Derived, never stored: whether a unit has someone living in it today. */
export const OCCUPANCY = ['Occupied', 'Notice', 'Vacant'] as const;
export type Occupancy = (typeof OCCUPANCY)[number];

export const LEASE_STATUSES = ['Draft', 'Pending signature', 'Active', 'Ended', 'Canceled'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];
export const LEASE_TYPES = ['Fixed term', 'Month-to-month'] as const;
export const RENEWAL_STATUSES = ['None', 'Offered', 'Accepted', 'Declined'] as const;
export const LEASE_TENANT_ROLES = ['Primary', 'Co-tenant', 'Occupant', 'Guarantor'] as const;

/**
 * What a lease is doing right now, for display and filtering — richer than the
 * stored status: an Active lease can be expiring, on notice or month-to-month.
 */
export const LEASE_PHASES = ['Draft', 'Pending signature', 'Upcoming', 'Current', 'Expiring', 'Notice', 'Month-to-month', 'Ended', 'Canceled'] as const;
export type LeasePhase = (typeof LEASE_PHASES)[number];

export const RECURRING_FREQUENCIES = ['Monthly', 'Quarterly', 'Annually'] as const;

export const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_SUBTYPES = [
  'Bank', 'Receivable', 'Other asset', 'Payable', 'Deposits held', 'Prepaid', 'Other liability',
  'Owner equity', 'Contributions', 'Distributions', 'Operating income', 'Other income', 'Operating expense', 'Other expense',
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

export const TRANSACTION_KINDS = [
  'Charge', 'Payment', 'Credit', 'Refund', 'Deposit application', 'Bill', 'Bill payment', 'Expense',
  'Owner contribution', 'Owner distribution', 'Management fee', 'Transfer', 'Journal entry',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export const TRANSACTION_STATUSES = ['Posted', 'Void'] as const;
export const PAYMENT_METHODS = ['Cash', 'Check', 'ACH', 'Card', 'Money order', 'Online', 'Other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const TRANSACTION_SOURCES = ['Manual', 'Recurring', 'Late fee', 'Portal', 'Online payment', 'Work order', 'Move-out', 'Import', 'System'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const VENDOR_TRADES = [
  'General', 'Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Landscaping', 'Cleaning', 'Pest control',
  'Roofing', 'Painting', 'Locksmith', 'Flooring', 'Utilities', 'Insurance', 'Other',
] as const;
export const VENDOR_STATUSES = ['Active', 'Inactive'] as const;

export const WORK_ORDER_STATUSES = ['New', 'Scheduled', 'In progress', 'On hold', 'Completed', 'Canceled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const OPEN_WORK_ORDER_STATUSES: WorkOrderStatus[] = ['New', 'Scheduled', 'In progress', 'On hold'];
export const WORK_ORDER_PRIORITIES = ['Emergency', 'High', 'Normal', 'Low'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];
export const WORK_ORDER_CATEGORIES = [
  'Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Pest control', 'Locks & keys', 'Doors & windows', 'Flooring',
  'Painting', 'Landscaping', 'Roofing', 'Cleaning', 'Safety', 'Turnover', 'General',
] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];
export const WORK_ORDER_SOURCES = ['Portal', 'Staff', 'Phone', 'Email', 'Inspection', 'Recurring'] as const;
export const OWNER_APPROVALS = ['Not required', 'Pending', 'Approved', 'Declined'] as const;

/** Days to resolve by priority, used for a work order's due date when none is set. */
export const PRIORITY_DUE_DAYS: Record<WorkOrderPriority, number> = { Emergency: 1, High: 3, Normal: 7, Low: 14 };

export const SCHEDULE_FREQUENCIES = ['Monthly', 'Quarterly', 'Semiannually', 'Annually'] as const;
export const SCHEDULE_MONTHS: Record<(typeof SCHEDULE_FREQUENCIES)[number], number> = { Monthly: 1, Quarterly: 3, Semiannually: 6, Annually: 12 };

export const INSPECTION_TYPES = ['Move-in', 'Move-out', 'Routine', 'Annual', 'Drive-by', 'Pre-listing'] as const;
export const INSPECTION_STATUSES = ['Scheduled', 'In progress', 'Completed', 'Canceled'] as const;
export const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor'] as const;
/** Per item in an inspection area. */
export const ITEM_CONDITIONS = ['Good', 'Fair', 'Poor', 'Damaged', 'Missing', 'N/A'] as const;

export const LISTING_STATUSES = ['Draft', 'Published', 'Paused', 'Leased'] as const;
export const PET_POLICIES = ['No pets', 'Cats only', 'Dogs only', 'Cats and dogs', 'Case by case'] as const;

export const INQUIRY_STATUSES = ['New', 'Contacted', 'Showing scheduled', 'Applied', 'Closed'] as const;
export const INQUIRY_SOURCES = ['Portal', 'Phone', 'Email', 'Walk-in', 'Listing site', 'Referral'] as const;

export const APPLICATION_STATUSES = ['Draft', 'Submitted', 'Screening', 'Approved', 'Denied', 'Withdrawn', 'Leased'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_SOURCES = ['Portal', 'Staff', 'Walk-in', 'Listing site', 'Referral'] as const;

/** The same checks for every applicant — consistent screening is a fair-housing requirement, not a nicety. */
export const SCREENING_CHECKS = [
  { key: 'identity', label: 'Identity verified' },
  { key: 'income', label: 'Income verified' },
  { key: 'employment', label: 'Employment verified' },
  { key: 'rental_history', label: 'Rental history / landlord reference' },
  { key: 'credit', label: 'Credit report reviewed' },
  { key: 'background', label: 'Background check reviewed' },
] as const;
export type ScreeningKey = (typeof SCREENING_CHECKS)[number]['key'];
export const SCREENING_RESULTS = ['Pending', 'Pass', 'Concern', 'Fail', 'Waived'] as const;

export const MESSAGE_DIRECTIONS = ['Inbound', 'Outbound', 'Internal'] as const;
export const MESSAGE_CHANNELS = ['Email', 'Portal', 'Note'] as const;
export const MESSAGE_DELIVERIES = ['Sent', 'Failed', 'Portal only', 'Received'] as const;

export const ANNOUNCEMENT_AUDIENCES = ['All residents', 'Selected properties', 'Owners', 'Vendors'] as const;
export const ANNOUNCEMENT_CHANNELS = ['Email and portal', 'Portal only'] as const;

export const DOCUMENT_CATEGORIES = ['Lease', 'Addendum', 'Notice', 'Insurance', 'Inspection', 'Statement', 'Invoice', 'Receipt', 'Photo', 'Identification', 'Other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const TASK_STATUSES = ['To do', 'In progress', 'Done', 'Canceled'] as const;
export const TASK_PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'] as const;
export const TASK_CATEGORIES = ['General', 'Leasing', 'Renewal', 'Move-in', 'Move-out', 'Maintenance', 'Inspection', 'Accounting', 'Compliance'] as const;

export const TEMPLATE_TRIGGERS = [
  'Manual', 'Rent reminder', 'Payment receipt', 'Late notice', 'Lease expiring', 'Renewal offer', 'Signature request', 'Welcome', 'Move-out',
  'Application received', 'Application approved', 'Application denied', 'Work order received', 'Work order scheduled', 'Work order completed',
  'Vendor assigned', 'Owner statement', 'Owner approval',
] as const;
export type TemplateTrigger = (typeof TEMPLATE_TRIGGERS)[number];
export const TEMPLATE_AUDIENCES = ['Tenant', 'Applicant', 'Owner', 'Vendor'] as const;
export type TemplateAudience = (typeof TEMPLATE_AUDIENCES)[number];

export const ONLINE_PAYMENT_STATUSES = ['Pending', 'Processing', 'Succeeded', 'Failed', 'Canceled'] as const;

export const LATE_FEE_TYPES = ['None', 'Flat', 'Percent'] as const;

/**
 * Colours for glyphs and chart series. Mid-tone hexes that read on both the
 * white and the near-black surface; text on tinted backgrounds uses the
 * semantic `tone-*` tokens instead, which are re-stepped per theme.
 */
export const COLORS = {
  gray: '#8b8d98',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  teal: '#0d9488',
  green: '#16a34a',
  amber: '#d97706',
  orange: '#ea580c',
  red: '#dc2626',
  pink: '#db2777',
} as const;

export const WORK_ORDER_STATUS_COLOR: Record<WorkOrderStatus, string> = {
  New: COLORS.gray,
  Scheduled: COLORS.blue,
  'In progress': COLORS.amber,
  'On hold': COLORS.violet,
  Completed: COLORS.green,
  Canceled: COLORS.gray,
};

export const PRIORITY_COLOR: Record<WorkOrderPriority, string> = { Emergency: COLORS.red, High: COLORS.orange, Normal: COLORS.gray, Low: COLORS.gray };

export const LEASE_PHASE_COLOR: Record<LeasePhase, string> = {
  Draft: COLORS.gray,
  'Pending signature': COLORS.violet,
  Upcoming: COLORS.blue,
  Current: COLORS.green,
  Expiring: COLORS.amber,
  Notice: COLORS.orange,
  'Month-to-month': COLORS.teal,
  Ended: COLORS.gray,
  Canceled: COLORS.gray,
};

export const APPLICATION_STATUS_COLOR: Record<ApplicationStatus, string> = {
  Draft: COLORS.gray,
  Submitted: COLORS.blue,
  Screening: COLORS.amber,
  Approved: COLORS.green,
  Denied: COLORS.red,
  Withdrawn: COLORS.gray,
  Leased: COLORS.teal,
};

export const OCCUPANCY_COLOR: Record<Occupancy, string> = { Occupied: COLORS.green, Notice: COLORS.amber, Vacant: COLORS.red };

/** Palette offered when someone picks a colour for a property or owner. */
export const SWATCHES = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#4f46e5', '#64748b'];
