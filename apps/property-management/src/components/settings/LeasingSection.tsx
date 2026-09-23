import { AlertTriangle, FileText, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { addDays, addMonths, todayIn } from '@project/shared/dates';
import { renderLeaseTerms } from '@project/shared/leaseDocument';
import { useAppActions } from '../../lib/app-actions';
import { useWorkspace } from '../../lib/workspace';
import { MoneyInput, NumberInput, Segmented } from '../form/fields';
import { insertAtCaret, MergeTagMenu, Note, unknownTags } from './controls';
import { Group, OrgSettingsForm, Row, type OrgForm } from './form';
import { lateFeeFor } from './rules';

const FIELDS = ['applicationsOpen', 'applicationFee', 'incomeMultiple', 'renewalNoticeDays', 'leaseTemplate'] as const;

/** The tags a lease agreement fills in (`leaseMergeContext`); anything else would print blank. */
const LEASE_TAGS = ['organization_name', 'tenant_names', 'property_name', 'unit_name', 'unit_address', 'lease_start_date', 'lease_end_date', 'rent_amount', 'rent_due_day', 'deposit_amount', 'late_fee', 'grace_period_days', 'renewal_term'] as const;

/** Settings → Leasing: applications, renewals and the lease agreement template. */
export default function LeasingSection() {
  const ws = useWorkspace();
  return (
    <OrgSettingsForm section="leasing" fields={FIELDS}>
      {form => {
        const { draft, set, errors } = form;
        return (
          <>
            <Group title="Applications">
              <Row label="Accept applications" description={draft.applicationsOpen ? 'Published listings in the portal show an Apply button.' : 'Listings still show in the portal, without an Apply button.'}>
                <div className="flex sm:justify-end"><Switch aria-label="Accept applications" checked={draft.applicationsOpen} onCheckedChange={v => set('applicationsOpen', v)} /></div>
              </Row>
              <Row label="Application fee" htmlFor="lease-fee" error={errors.applicationFee} description="Charged when someone submits an application. Set to 0 for no fee. A listing can use its own.">
                <div data-field="applicationFee"><MoneyInput id="lease-fee" value={draft.applicationFee} onChange={v => set('applicationFee', v as number)} invalid={Boolean(errors.applicationFee)} prefix={ws.money(0).replace(/[\d.,\s]/g, '') || '$'} /></div>
              </Row>
              <Row
                label="Income requirement"
                htmlFor="lease-income"
                error={errors.incomeMultiple}
                description={draft.incomeMultiple ? `The application tells people you usually look for household income of about ${draft.incomeMultiple}× the rent. It’s guidance — your team still decides.` : 'No income requirement is shown to applicants.'}
              >
                <div data-field="incomeMultiple"><NumberInput id="lease-income" min={0} max={10} step={0.1} value={draft.incomeMultiple} onChange={v => set('incomeMultiple', v as number)} invalid={Boolean(errors.incomeMultiple)} suffix="× rent" className="[&_input]:pr-14" /></div>
              </Row>
            </Group>

            <Group title="Renewals">
              <Row label="Start renewals" htmlFor="lease-renewal" error={errors.renewalNoticeDays} description={`The morning automation opens a “Decide on renewal” task for the property manager ${draft.renewalNoticeDays ?? 0} days before a fixed-term lease ends.`}>
                <div data-field="renewalNoticeDays"><NumberInput id="lease-renewal" min={0} max={365} value={draft.renewalNoticeDays} onChange={v => set('renewalNoticeDays', v as number)} invalid={Boolean(errors.renewalNoticeDays)} suffix="days before" className="[&_input]:pr-24" /></div>
              </Row>
            </Group>

            <LeaseTemplateEditor form={form} />
          </>
        );
      }}
    </OrgSettingsForm>
  );
}

function LeaseTemplateEditor({ form }: { form: OrgForm<(typeof FIELDS)[number]> }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { data, draft, set, errors } = form;
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const area = useRef<HTMLTextAreaElement>(null);
  const defaultTemplate = data.defaults.leaseTemplate;
  const isDefault = draft.leaseTemplate.trim() === defaultTemplate.trim();
  const unknown = useMemo(() => unknownTags([draft.leaseTemplate], LEASE_TAGS), [draft.leaseTemplate]);

  // Preview against a real unit when there is one, so the sample reads like their own lease.
  const sample = useMemo(() => {
    const s = data.settings;
    const unit = ws.units.find(u => !u.archived && u.currentRent) ?? ws.units.find(u => !u.archived);
    const property = unit ? ws.propertyById.get(unit.propertyId) : undefined;
    const today = todayIn(s.timezone);
    const start = `${addMonths(today, 1).slice(0, 7)}-01`;
    const rent = unit?.currentRent ?? unit?.marketRent ?? 1895;
    return {
      label: property && unit ? ws.unitLabel(unit.id) : 'a sample unit',
      input: {
        organizationName: s.organizationName,
        currency: s.currency,
        gracePeriodDays: s.gracePeriodDays,
        lateFee: lateFeeFor(s, rent),
        property: property ?? { name: 'The Alder', street: '1450 N Marion St', city: 'Denver', state: 'CO', postalCode: '80218' },
        unitName: unit?.name ?? '204',
        tenantNames: ['Maya Chen', 'Jordan Chen'],
        startDate: start,
        endDate: addDays(addMonths(start, 12), -1),
        rent,
        deposit: unit?.depositAmount || rent,
        rentDueDay: s.rentDueDay,
      },
    };
  }, [data.settings, ws]);

  const rendered = useMemo(() => (tab === 'preview' ? renderLeaseTerms(draft.leaseTemplate, sample.input) : ''), [tab, draft.leaseTemplate, sample]);

  const reset = async () => {
    const ok = await app.confirm({ title: 'Reset the lease template?', description: 'Your wording is replaced with the standard lease. Nothing changes until you save, and leases already sent keep the terms they were signed with.', confirmLabel: 'Reset template' });
    if (ok) set('leaseTemplate', defaultTemplate);
  };

  return (
    <Group
      title="Lease agreement"
      description="The agreement that’s filled in and sent for signature. Signed leases keep the wording they were signed with."
      action={
        !isDefault && (
          <button type="button" onClick={() => void reset()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </button>
        )
      }
      flush
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-subtle/60 px-3 py-2">
        <Segmented size="sm" value={tab} onChange={v => setTab(v as 'write' | 'preview')} options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
        <span className="hidden text-sm text-muted-foreground sm:inline">{tab === 'write' ? 'Markdown: # headings, **bold**, - lists' : `Filled in for ${sample.label}`}</span>
        <div className="ml-auto">
          {tab === 'write' && <MergeTagMenu tags={LEASE_TAGS} onPick={tag => set('leaseTemplate', insertAtCaret(area.current, draft.leaseTemplate, `{{${tag}}}`))} />}
        </div>
      </div>
      {tab === 'write' ? (
        <div data-field="leaseTemplate">
          <textarea
            ref={area}
            aria-label="Lease template"
            value={draft.leaseTemplate}
            onChange={e => set('leaseTemplate', e.target.value)}
            spellCheck
            className={cn('block min-h-[420px] w-full resize-y bg-card px-4 py-3 font-mono text-[13.5px] leading-relaxed outline-none', errors.leaseTemplate && 'bg-tone-danger/[0.04]')}
          />
        </div>
      ) : (
        <div className="max-h-[560px] overflow-y-auto bg-subtle/40 px-3 py-4 sm:px-6">
          <article className="prose-ks mx-auto max-w-[640px] rounded-md border bg-background px-6 py-5 shadow-xs sm:px-10 sm:py-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{rendered}</ReactMarkdown>
          </article>
        </div>
      )}
      {errors.leaseTemplate && <p role="alert" className="border-t px-4 py-2 text-sm text-tone-danger">{errors.leaseTemplate}</p>}
      {unknown.length > 0 && (
        <div className="border-t">
          <Note tone="warning" icon={<AlertTriangle />}>
            {unknown.map(t => `{{${t}}}`).join(', ')} {unknown.length === 1 ? 'isn’t' : 'aren’t'} filled in on leases and will print blank.
          </Note>
        </div>
      )}
      {tab === 'write' && isDefault && (
        <div className="border-t">
          <Note icon={<FileText />}>This is the standard residential lease. Have a local attorney review it before you use it — rules on deposits, late fees and notice differ by state.</Note>
        </div>
      )}
    </Group>
  );
}
