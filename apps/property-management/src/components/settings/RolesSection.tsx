import { Check, Minus } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '@project/shared/constants';
import { can, CAPABILITIES, ROLE_DESCRIPTIONS, type Capability } from '@project/shared/roles';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { SECTIONS } from './data';
import { Group, SectionHeader } from './form';

/** What each capability lets someone do, in the words people use. */
const CAPABILITY_LABELS: Record<Capability, { label: string; description: string; group: string }> = {
  'portfolio.manage': { label: 'Properties and units', description: 'Add and edit properties and units, and set who manages them.', group: 'Portfolio' },
  'owners.manage': { label: 'Owners', description: 'Add owners, set management fees and distribution methods.', group: 'Portfolio' },
  'leasing.manage': { label: 'Leasing', description: 'Listings, inquiries and applications, including decisions.', group: 'Leasing' },
  'residents.manage': { label: 'Leases and residents', description: 'Create and renew leases, move residents in and out.', group: 'Leasing' },
  'maintenance.manage': { label: 'Manage maintenance', description: 'Assign and schedule work orders, vendors, inspections and recurring maintenance.', group: 'Maintenance' },
  'maintenance.create': { label: 'Report maintenance', description: 'Create work orders and follow the ones they’re involved in.', group: 'Maintenance' },
  'vendors.manage': { label: 'Vendors', description: 'Add vendors and track insurance and W-9s.', group: 'Maintenance' },
  'accounting.view': { label: 'See financials', description: 'Balances, ledgers and accounting pages.', group: 'Money' },
  'receivables.manage': { label: 'Charges and payments', description: 'Post charges, receive payments, credits and deposits.', group: 'Money' },
  'payables.manage': { label: 'Bills', description: 'Enter and pay vendor bills and expenses.', group: 'Money' },
  'banking.manage': { label: 'Banking and the ledger', description: 'Bank accounts, transfers, reconciliation, journal entries and owner distributions.', group: 'Money' },
  'reports.view': { label: 'Reports', description: 'Rent roll, owner statements, income and aging reports.', group: 'Money' },
  'communications.send': { label: 'Messages', description: 'Message residents, owners, vendors and applicants.', group: 'Communication' },
  'announcements.send': { label: 'Announcements', description: 'Send announcements to whole properties.', group: 'Communication' },
  'settings.manage': { label: 'Settings', description: 'Organization policies, email templates, automation and demo data.', group: 'Administration' },
  'members.manage': { label: 'Team', description: 'Invite people, change roles and remove access.', group: 'Administration' },
};

/** Settings → Roles & permissions: a read-only map of what each role can do. */
export default function RolesSection() {
  const ws = useWorkspace();
  const def = SECTIONS.find(s => s.key === 'roles')!;
  const counts = new Map(ROLES.map(r => [r, ws.members.filter(m => m.role === r && m.status !== 'Deactivated').length]));
  const groups = [...new Set(CAPABILITIES.map(c => CAPABILITY_LABELS[c].group))];

  return (
    <>
      <SectionHeader title={def.label} description="Every teammate has one role. Roles are fixed so permissions stay predictable — change someone’s role in Team." />

      <Group title="Roles">
        {ROLES.map(r => (
          <div key={r} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="w-[150px] shrink-0 text-[14px] font-medium">{r}</div>
            <p className="min-w-0 flex-1 text-[14px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
            <Link to="/settings/team" className="shrink-0 text-sm tabular-nums text-muted-foreground hover:text-foreground">{plural(counts.get(r) ?? 0, 'person', 'people')}</Link>
          </div>
        ))}
      </Group>

      <Group title="Permissions" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b bg-subtle/60">
                <th scope="col" className="h-9 px-4 text-left text-sm font-normal text-muted-foreground">Can…</th>
                {ROLES.map(r => (
                  <th key={r} scope="col" className="h-9 w-[84px] px-1 text-center text-sm font-medium leading-tight">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <Fragment key={g}>
                  <tr className="border-b">
                    <th colSpan={ROLES.length + 1} scope="colgroup" className="bg-subtle/30 px-4 pb-1.5 pt-3 text-left text-sm font-medium text-muted-foreground">{g}</th>
                  </tr>
                  {CAPABILITIES.filter(c => CAPABILITY_LABELS[c].group === g).map(c => (
                    <tr key={c} className="border-b last:border-b-0 hover:bg-accent/30">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">
                        <div className="font-medium">{CAPABILITY_LABELS[c].label}</div>
                        <div className="text-sm text-muted-foreground">{CAPABILITY_LABELS[c].description}</div>
                      </th>
                      {ROLES.map(r => (
                        <td key={r} className="px-1 text-center">
                          {can(r, c) ? (
                            <Check className="mx-auto h-4 w-4 text-tone-success" aria-label={`${r} can`} />
                          ) : (
                            <Minus className="mx-auto h-3.5 w-3.5 text-muted-foreground/50" aria-label={`${r} can’t`} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Group>
    </>
  );
}
