import type { TemplateAudience, TemplateTrigger } from './constants';

/**
 * The emails the app sends out of the box. Every install gets these, demo or
 * not; organizations edit them under Settings → Email templates. Plain text
 * with blank lines between paragraphs — the email gateway lays it out.
 */

export type TemplateDef = { name: string; trigger: TemplateTrigger; audience: TemplateAudience; subject: string; body: string; enabled: boolean };

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'Rent reminder',
    trigger: 'Rent reminder',
    audience: 'Tenant',
    subject: 'Rent of {{balance_due}} is due {{due_date}}',
    body: `Hi {{recipient_first_name}},

A friendly reminder that rent for {{unit_address}} is due on {{due_date}}. Your amount due is {{balance_due}}.

You can pay online in the resident portal in under a minute: {{portal_link}}

If you've already paid, thank you — you can ignore this message.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Payment receipt',
    trigger: 'Payment receipt',
    audience: 'Tenant',
    subject: 'Receipt: we received your payment of {{amount_paid}}',
    body: `Hi {{recipient_first_name}},

Thanks — we received your payment of {{amount_paid}} on {{payment_date}} ({{payment_method}}). Receipt #{{receipt_number}}.

Your remaining balance is {{balance_due}}.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Late notice',
    trigger: 'Late notice',
    audience: 'Tenant',
    subject: 'Your rent is past due',
    body: `Hi {{recipient_first_name}},

We haven't received your full rent payment for {{unit_address}}, and the {{grace_period_days}}-day grace period has passed. A late fee of {{late_fee}} has been added to your account.

Your balance is now {{balance_due}}. Please pay as soon as possible in the resident portal: {{portal_link}}

If something has come up and you need to talk about a payment plan, reply to this email or call us at {{office_phone}}. We'd rather hear from you early.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Lease expiring',
    trigger: 'Lease expiring',
    audience: 'Tenant',
    subject: 'Your lease ends {{lease_end_date}}',
    body: `Hi {{recipient_first_name}},

Your lease at {{unit_address}} ends on {{lease_end_date}}. We'll be in touch soon about renewing — if you already know your plans, just reply and let us know.

{{organization_name}}`,
    enabled: false,
  },
  {
    name: 'Renewal offer',
    trigger: 'Renewal offer',
    audience: 'Tenant',
    subject: 'Your renewal offer for {{unit_address}}',
    body: `Hi {{recipient_first_name}},

We'd love for you to stay. Here's your renewal offer:

New monthly rent: {{renewal_rent}}
Term: {{renewal_term}}
Please respond by: {{renewal_expires}}

You can accept or decline in the resident portal: {{portal_link}}

Questions? Reply to this email or call {{office_phone}}.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Lease ready to sign',
    trigger: 'Signature request',
    audience: 'Tenant',
    subject: 'Your lease for {{unit_address}} is ready to sign',
    body: `Hi {{recipient_first_name}},

Your lease for {{unit_address}} is ready. It starts {{lease_start_date}} at {{rent_amount}} per month.

Review and sign it in the resident portal: {{portal_link}}

Once everyone on the lease has signed, we'll countersign and send you a copy.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Welcome home',
    trigger: 'Welcome',
    audience: 'Tenant',
    subject: 'Welcome to {{property_name}}',
    body: `Hi {{recipient_first_name}},

Welcome home! Your lease at {{unit_address}} is active.

Your resident portal is where you pay rent, request maintenance and find your documents: {{portal_link}}

For maintenance emergencies — no heat, flooding, gas smell, no power — call {{emergency_phone}} any time, day or night.

We're glad you're here.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Move-out summary',
    trigger: 'Move-out',
    audience: 'Tenant',
    subject: 'Your move-out and security deposit',
    body: `Hi {{recipient_first_name}},

Thank you for living at {{unit_address}}. We've completed your move-out and settled your security deposit of {{deposit_amount}}.

You can see the itemized statement in the resident portal: {{portal_link}}

Wishing you the best in your new home.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Application received',
    trigger: 'Application received',
    audience: 'Applicant',
    subject: 'We received your application ({{application_number}})',
    body: `Hi {{recipient_first_name}},

Thanks for applying for {{listing_title}}. Your application number is {{application_number}}.

We review applications in the order they're received, usually within two business days. We'll email you as soon as there's a decision, and you can check the status any time: {{portal_link}}

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Application approved',
    trigger: 'Application approved',
    audience: 'Applicant',
    subject: 'Good news about your application',
    body: `Hi {{recipient_first_name}},

Your application for {{listing_title}} has been approved.

We'll send your lease for electronic signature shortly. If you have any questions in the meantime, reply to this email or call {{office_phone}}.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Application not approved',
    trigger: 'Application denied',
    audience: 'Applicant',
    subject: 'An update on your application',
    body: `Hi {{recipient_first_name}},

Thank you for your interest in {{listing_title}}. After reviewing your application, we're unable to approve it at this time.

If our decision was based on information from a consumer reporting agency, you have the right to a free copy of that report within 60 days and to dispute its accuracy. Reply to this email and we'll share the agency's contact details.

We appreciate you considering us.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Maintenance request received',
    trigger: 'Work order received',
    audience: 'Tenant',
    subject: 'We received your request: {{work_order_title}}',
    body: `Hi {{recipient_first_name}},

We received your maintenance request ({{work_order_number}}): {{work_order_title}}.

We'll let you know when it's scheduled. You can add details or photos and follow along in the portal: {{portal_link}}

If this is an emergency — flooding, no heat, gas smell, no power — please call {{emergency_phone}} now.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Maintenance scheduled',
    trigger: 'Work order scheduled',
    audience: 'Tenant',
    subject: 'Scheduled: {{work_order_title}}',
    body: `Hi {{recipient_first_name}},

Your maintenance request {{work_order_number}} is scheduled for {{scheduled_for}}. {{vendor_name}} will take care of it.

If that time doesn't work, reply to this email or message us in the portal.

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Maintenance completed',
    trigger: 'Work order completed',
    audience: 'Tenant',
    subject: 'Completed: {{work_order_title}}',
    body: `Hi {{recipient_first_name}},

Your maintenance request {{work_order_number}} ({{work_order_title}}) has been completed.

How did we do? Rate the work in the portal — it takes ten seconds and helps us choose the right vendors: {{portal_link}}

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Vendor work order assigned',
    trigger: 'Vendor assigned',
    audience: 'Vendor',
    subject: 'New work order {{work_order_number}} at {{property_name}}',
    body: `Hi {{recipient_first_name}},

You've been assigned work order {{work_order_number}}: {{work_order_title}}

Location: {{unit_address}}
Scheduled: {{scheduled_for}}

See the details, update the status and submit your invoice in the vendor portal: {{portal_link}}

Thanks,
{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Owner statement',
    trigger: 'Owner statement',
    audience: 'Owner',
    subject: 'Your owner statement for {{statement_period}}',
    body: `Hi {{recipient_first_name}},

Your owner statement for {{statement_period}} is ready. Net income for the period was {{net_income}}.

View the full statement, distributions and documents in your owner portal: {{portal_link}}

{{organization_name}}`,
    enabled: true,
  },
  {
    name: 'Owner approval needed',
    trigger: 'Owner approval',
    audience: 'Owner',
    subject: 'Approval needed: {{work_order_title}} ({{estimate_amount}})',
    body: `Hi {{recipient_first_name}},

We need your approval for a repair at {{property_name}}:

{{work_order_title}}
Estimate: {{estimate_amount}}

Approve or decline in your owner portal: {{portal_link}}

If you'd like to talk it through, reply here or call {{office_phone}}.

{{organization_name}}`,
    enabled: true,
  },
];
