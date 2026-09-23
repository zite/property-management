import { useQueryClient } from '@tanstack/react-query';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { decideApplication } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { applicationRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { Field, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { afterLeasingWrite, lk } from './data';
import { APPROVAL_CONDITIONS, DENIAL_REASONS, type DenialReason } from './rules';

export type DecisionKind = 'approve' | 'deny' | 'withdraw' | 'reopen';

export type DecisionTarget = {
  id: string;
  number: number | null;
  applicantName: string;
  status: string;
  listingTitle?: string | null;
  unitId?: string | null;
  propertyId?: string | null;
  email?: string;
  phone?: string;
  desiredMoveIn?: string | null;
  rent?: number | null;
  deposit?: number | null;
};

/** Pre-fill for the lease dialog from an approved application (keys the Leases area's NewLeaseDialog reads). */
export function leaseDefaultsFor(a: DecisionTarget) {
  return {
    applicationId: a.id,
    unitId: a.unitId ?? undefined,
    propertyId: a.propertyId ?? undefined,
    startDate: a.desiredMoveIn ?? undefined,
    rent: a.rent ?? undefined,
    deposit: a.deposit ?? undefined,
    tenantName: a.applicantName,
    tenantEmail: a.email || undefined,
    tenantPhone: a.phone || undefined,
  };
}

/**
 * Approve, deny, withdraw or reopen — the only ways an application's decision
 * changes. A person makes the call from the screening record; the dialog shows
 * exactly what the applicant will receive.
 */
export function DecisionDialog({ kind, target, onOpenChange, otherOpen = 0 }: { kind: DecisionKind | null; target: DecisionTarget | null; onOpenChange: (open: boolean) => void; otherOpen?: number }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const open = Boolean(kind && target);
  const [conditions, setConditions] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState<DenialReason | null>(null);
  const [note, setNote] = useState('');
  const [notifyApplicant, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConditions([]);
    setCustom('');
    setReason(null);
    setNote('');
    setNotify(true);
    setError(null);
  }, [open, kind, target?.id]);

  if (!kind || !target) return null;

  const ref = applicationRef(target.number);
  const first = target.applicantName.split(' ')[0];
  const trigger = kind === 'approve' ? 'Application approved' : 'Application denied';
  const template = ws.templates.find(t => t.trigger === trigger);
  const templateOn = Boolean(template?.enabled);

  const submit = async () => {
    if (kind === 'deny' && !reason) {
      setError('Choose the reason for this decision.');
      return;
    }
    setPending(true);
    try {
      const allConditions = [...conditions, ...(custom.trim() ? [custom.trim()] : [])];
      const res =
        kind === 'approve' ? await decideApplication({ action: 'approve', id: target.id, conditions: allConditions, note, notifyApplicant })
        : kind === 'deny' ? await decideApplication({ action: 'deny', id: target.id, reason: reason!, note, notifyApplicant })
        : kind === 'withdraw' ? await decideApplication({ action: 'withdraw', id: target.id, note })
        : await decideApplication({ action: 'reopen', id: target.id, note });
      await qc.invalidateQueries({ queryKey: lk.applicationDetail(target.number ?? 0) });
      afterLeasingWrite(qc);
      const emailed = res.emailed === 'Sent' ? ` ${first} was emailed.` : res.emailed === 'Failed' ? ` The email to ${first} couldn’t be delivered.` : '';
      if (kind === 'approve') {
        toast.success(`${ref} approved`, {
          description: `${emailed.trim()}${res.otherOpen.length ? ` ${res.otherOpen.length} other ${res.otherOpen.length === 1 ? 'application for this unit is' : 'applications for this unit are'} still open.` : ''}`.trim() || undefined,
          action: ws.can('residents.manage') ? { label: 'Create lease', onClick: () => app.openCreate('lease', leaseDefaultsFor(target)) } : undefined,
        });
      } else if (kind === 'deny') {
        toast.success(`${ref} denied`, { description: emailed.trim() || undefined });
      } else {
        toast.success(kind === 'withdraw' ? `${ref} withdrawn` : `${ref} reopened`);
      }
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'The decision wasn’t saved. Try again.'));
    } finally {
      setPending(false);
    }
  };

  const title = kind === 'approve' ? `Approve ${target.applicantName}` : kind === 'deny' ? `Deny ${ref}` : kind === 'withdraw' ? `Withdraw ${ref}` : `Reopen ${ref}`;
  const description =
    kind === 'approve' ? `${ref}${target.listingTitle ? ` for ${target.listingTitle}` : ''}.`
    : kind === 'deny' ? `${target.applicantName}${target.listingTitle ? ` · ${target.listingTitle}` : ''}. Use the same criteria for every applicant.`
    : kind === 'withdraw' ? 'Use this when the applicant has told you they’re no longer interested. No email is sent.'
    : 'It goes back into review with its screening results intact. No email is sent.';

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={submit}
      pending={pending}
      destructive={kind === 'deny' || kind === 'withdraw'}
      submitLabel={kind === 'approve' ? 'Approve' : kind === 'deny' ? 'Deny application' : kind === 'withdraw' ? 'Withdraw' : 'Reopen'}
      footerStart={error ? <span className="text-tone-danger">{error}</span> : undefined}
    >
      <div className="space-y-4">
        {kind === 'approve' && otherOpen > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[13.5px]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
            <span>{otherOpen} other {otherOpen === 1 ? 'application for this unit is' : 'applications for this unit are'} still open. Decide on {otherOpen === 1 ? 'it' : 'them'} after this one — approving doesn’t change them.</span>
          </p>
        )}

        {kind === 'approve' && (
          <Field label="Conditions" optional hint="Listed in the approval email. Leave empty for a standard approval.">
            <div className="space-y-1">
              {APPROVAL_CONDITIONS.map(c => {
                const on = conditions.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setConditions(list => (on ? list.filter(x => x !== c) : [...list, c]))}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-accent"
                  >
                    <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>{on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
                    {c}
                  </button>
                );
              })}
              <TextInput value={custom} onChange={e => setCustom(e.target.value)} placeholder="Another condition, e.g. Co-signer on the lease" maxLength={160} className="mt-1" />
            </div>
          </Field>
        )}

        {kind === 'deny' && (
          <Field label="Reason" error={error && !reason ? error : null} hint="Kept with your team — it isn’t included in the email.">
            <div role="radiogroup" aria-label="Reason" className="space-y-0.5 rounded-md border p-1">
              {DENIAL_REASONS.map((r, i) => (
                <button
                  key={r}
                  data-autofocus={i === 0 ? true : undefined}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  onClick={() => { setReason(r); setError(null); }}
                  className={cn('flex min-h-9 w-full items-center gap-2 rounded-[5px] px-2 py-1 text-left text-[14px] hover:bg-accent', reason === r && 'bg-accent')}
                >
                  <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', reason === r ? 'border-primary' : 'border-input')}>{reason === r && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}</span>
                  {r}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label={kind === 'deny' ? 'Details for your team' : kind === 'withdraw' ? 'Why' : 'Note'} optional>
          <TextArea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} placeholder={kind === 'deny' ? 'What in the screening supports this — e.g. income 1.9× rent, no guarantor offered.' : kind === 'withdraw' ? 'e.g. Signed a lease elsewhere.' : kind === 'reopen' ? 'e.g. Added a guarantor.' : 'Anything the team should know about this approval.'} />
        </Field>

        {(kind === 'approve' || kind === 'deny') && (
          <div className="rounded-md border bg-subtle/60 px-3 py-2.5">
            <SwitchRow
              label={`Email ${first}`}
              description={
                !templateOn
                  ? `The “${template?.name ?? trigger}” template is switched off in Settings, so nothing will be sent.`
                  : kind === 'approve'
                    ? `Sends your “${template?.name}” template${conditions.length || custom.trim() ? ' with the conditions listed' : ''}.`
                    : 'Sends a neutral notice that the application wasn’t approved, and that they can ask you for the reason.'
              }
              checked={notifyApplicant && templateOn}
              onChange={setNotify}
              disabled={!templateOn}
            />
          </div>
        )}
        {kind === 'deny' && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Decisions are made by your team from the screening record. AI is never used to judge applicants.
          </p>
        )}
      </div>
    </FormDialog>
  );
}
