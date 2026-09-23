/**
 * Merge tags for email templates and the lease agreement: `{{tenant_first_name}}`.
 *
 * Unknown or empty tags render as nothing rather than leaking braces into an
 * email. The template editor's preview uses this same function with the
 * sample values, so what staff preview is what gets sent.
 */

export const MERGE_TAGS = [
  { tag: 'recipient_name', label: 'Recipient name', sample: 'Maya Chen', group: 'People' },
  { tag: 'recipient_first_name', label: 'Recipient first name', sample: 'Maya', group: 'People' },
  { tag: 'tenant_names', label: 'All tenants on the lease', sample: 'Maya Chen and Jordan Chen', group: 'People' },
  { tag: 'organization_name', label: 'Your company', sample: 'Cedar & Main Property Management', group: 'Company' },
  { tag: 'office_phone', label: 'Office phone', sample: '(303) 555-0142', group: 'Company' },
  { tag: 'support_email', label: 'Support email', sample: 'help@example.com', group: 'Company' },
  { tag: 'emergency_phone', label: 'Emergency maintenance line', sample: '(303) 555-0199', group: 'Company' },
  { tag: 'portal_link', label: 'Portal link', sample: 'https://portal.example.com', group: 'Company' },
  { tag: 'property_name', label: 'Property', sample: 'The Alder', group: 'Home' },
  { tag: 'unit_name', label: 'Unit', sample: 'Unit 204', group: 'Home' },
  { tag: 'unit_address', label: 'Full address', sample: '1450 N Marion St, Unit 204, Denver, CO 80218', group: 'Home' },
  { tag: 'lease_start_date', label: 'Lease start', sample: 'October 1, 2026', group: 'Lease' },
  { tag: 'lease_end_date', label: 'Lease end', sample: 'September 30, 2027', group: 'Lease' },
  { tag: 'rent_amount', label: 'Monthly rent', sample: '$1,895.00', group: 'Lease' },
  { tag: 'rent_due_day', label: 'Rent due day', sample: '1st', group: 'Lease' },
  { tag: 'deposit_amount', label: 'Security deposit', sample: '$1,895.00', group: 'Lease' },
  { tag: 'late_fee', label: 'Late fee', sample: '$75.00', group: 'Lease' },
  { tag: 'grace_period_days', label: 'Grace period (days)', sample: '5', group: 'Lease' },
  { tag: 'balance_due', label: 'Balance due', sample: '$1,970.00', group: 'Money' },
  { tag: 'due_date', label: 'Due date', sample: 'October 1, 2026', group: 'Money' },
  { tag: 'amount_paid', label: 'Amount paid', sample: '$1,895.00', group: 'Money' },
  { tag: 'payment_date', label: 'Payment date', sample: 'September 28, 2026', group: 'Money' },
  { tag: 'payment_method', label: 'Payment method', sample: 'ACH', group: 'Money' },
  { tag: 'receipt_number', label: 'Receipt number', sample: '1482', group: 'Money' },
  { tag: 'renewal_rent', label: 'Renewal rent', sample: '$1,950.00', group: 'Renewal' },
  { tag: 'renewal_term', label: 'Renewal term', sample: '12 months', group: 'Renewal' },
  { tag: 'renewal_expires', label: 'Offer expires', sample: 'October 15, 2026', group: 'Renewal' },
  { tag: 'work_order_number', label: 'Work order number', sample: 'WO-1042', group: 'Maintenance' },
  { tag: 'work_order_title', label: 'Work order title', sample: 'Kitchen sink leaking under cabinet', group: 'Maintenance' },
  { tag: 'work_order_status', label: 'Work order status', sample: 'Scheduled', group: 'Maintenance' },
  { tag: 'scheduled_for', label: 'Scheduled for', sample: 'Thursday, October 2 at 9:00 AM', group: 'Maintenance' },
  { tag: 'vendor_name', label: 'Vendor', sample: 'Front Range Plumbing', group: 'Maintenance' },
  { tag: 'estimate_amount', label: 'Estimate', sample: '$640.00', group: 'Maintenance' },
  { tag: 'statement_period', label: 'Statement period', sample: 'September 2026', group: 'Owners' },
  { tag: 'net_income', label: 'Net income for the period', sample: '$8,412.50', group: 'Owners' },
  { tag: 'applicant_name', label: 'Applicant name', sample: 'Sam Rivera', group: 'Applications' },
  { tag: 'application_number', label: 'Application number', sample: 'APP-208', group: 'Applications' },
  { tag: 'listing_title', label: 'Listing', sample: '2BR with balcony at The Alder', group: 'Applications' },
] as const;

export type MergeTag = (typeof MERGE_TAGS)[number]['tag'];
export type MergeContext = Partial<Record<MergeTag, string>>;

export function renderMerge(template: string, ctx: MergeContext) {
  return (template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, tag: string) => {
    const v = (ctx as Record<string, string | undefined>)[tag.toLowerCase()];
    return v == null ? '' : String(v);
  });
}

export const sampleMergeContext = (): MergeContext => Object.fromEntries(MERGE_TAGS.map(t => [t.tag, t.sample])) as MergeContext;

export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "Maya Chen", "Maya Chen and Jordan Chen", "A, B and C". */
export function joinNames(names: Array<string | null | undefined>) {
  const list = names.map(n => (n ?? '').trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function formatAddress(p: { street?: string | null; city?: string | null; state?: string | null; postalCode?: string | null }, unitName?: string | null) {
  const unit = unitName && !/^(main|house|home)$/i.test(unitName) ? (/^[A-Z]?\d+[A-Z]?$|^[A-Z]\d*$/i.test(unitName) ? `Unit ${unitName}` : unitName) : null;
  const street = [p.street, unit].filter(Boolean).join(', ');
  const cityLine = [p.city, [p.state, p.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, cityLine].filter(Boolean).join(', ');
}
