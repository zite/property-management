import { AlertCircle, CheckCircle2, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { APPLY_STEPS, CONTENT_STEPS, durationLabel, householdIncome, signatureMatches, type ApplicationForm, type Errors, type StepId } from '../../lib/applyRules';
import { formatMoney, longDate } from '../../lib/format';
import { Alert, StatusPill, inputClass } from '../ui';
import { fieldId } from './fields';

type Props = {
  form: ApplicationForm;
  email: string;
  errorsByStep: Record<string, Errors>;
  onEdit: (step: StepId, field?: string) => void;
  currency: string;
  organizationName: string;
  fee: number;
  collectOnline: boolean;
  feePaidAt: string | null;
  consent: boolean;
  onConsent: (v: boolean) => void;
  signature: string;
  onSignature: (v: string) => void;
  signErrors: { consent?: string; signature?: string };
  readOnly?: boolean;
  children?: ReactNode;
};

const money = (n: number | null, currency: string) => (n == null ? '' : formatMoney(n, currency, { cents: Math.round(n * 100) % 100 !== 0 }));

/**
 * Everything the applicant said, grouped the way they answered it, with an
 * Edit link on each group — then consent, signature and the fee. Also used
 * read-only on the status page so people can see exactly what they sent.
 */
export function ApplicationSummary({ form, email, errorsByStep, onEdit, currency, readOnly }: Pick<Props, 'form' | 'email' | 'errorsByStep' | 'onEdit' | 'currency' | 'readOnly'>) {
  const household = householdIncome(form);
  const sections: Record<string, Array<[string, ReactNode]>> = {
    about: [
      ['Legal name', form.applicantName],
      ['Email', email],
      ['Phone', form.phone],
      ['Move-in date', form.desiredMoveIn ? longDate(form.desiredMoveIn) : ''],
      ['People in the home', form.occupants != null ? String(form.occupants) : ''],
    ],
    residence: [
      ['Address', form.currentAddress],
      ['Monthly rent', money(form.currentRent, currency)],
      ['Landlord', [form.currentLandlord, form.landlordPhone].filter(Boolean).join(' · ')],
      ['Lived there', durationLabel(form.residenceMonths)],
      ['Reason for moving', form.reasonForMoving],
      ['Ever evicted', form.priorEviction == null ? '' : form.priorEviction ? 'Yes' : 'No'],
    ],
    income: [
      ['Employer', form.employer],
      ['Job title', form.jobTitle],
      ['Time there', durationLabel(form.employmentMonths)],
      ['Gross monthly income', money(form.monthlyIncome, currency)],
      ...(form.coApplicants.length ? ([['Household income', money(household, currency)]] as Array<[string, ReactNode]>) : []),
    ],
    household: [
      [
        'Co-applicants',
        form.coApplicants.length ? (
          <ul className="space-y-1">
            {form.coApplicants.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.name || 'Unnamed'}</span>
                <span className="text-muted-foreground">{[c.relationship, c.email, c.monthlyIncome != null ? `${money(c.monthlyIncome, currency)}/mo` : ''].filter(Boolean).map(v => ` · ${v}`).join('')}</span>
              </li>
            ))}
          </ul>
        ) : (
          'None'
        ),
      ],
      ['Pets', form.hasPets == null ? '' : form.hasPets ? form.pets : 'None'],
      ['Vehicles', form.hasVehicles == null ? '' : form.hasVehicles ? form.vehicles : 'None'],
    ],
    references: [
      [
        form.references.length === 1 ? 'Reference' : 'References',
        form.references.some(r => r.name) ? (
          <ul className="space-y-1">
            {form.references.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">{[r.relationship, r.phone, r.email].filter(Boolean).map(v => ` · ${v}`).join('')}</span>
              </li>
            ))}
          </ul>
        ) : (
          ''
        ),
      ],
      ['Emergency contact', [form.emergencyContact.name, form.emergencyContact.relationship, form.emergencyContact.phone].filter(Boolean).join(' · ')],
    ],
  };

  return (
    <div className="space-y-4">
      {CONTENT_STEPS.map(step => {
        const errors = errorsByStep[step] ?? {};
        const problems = Object.entries(errors);
        const title = APPLY_STEPS.find(s => s.id === step)!.title;
        return (
          <section key={step} className={cn('rounded-xl border bg-card', problems.length > 0 && !readOnly && 'border-tone-danger/40')} aria-labelledby={`review-${step}`}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <h3 id={`review-${step}`} className="flex min-w-0 items-center gap-2 font-semibold">
                {!readOnly && (problems.length ? <AlertCircle className="h-4 w-4 shrink-0 text-tone-danger" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-tone-success" aria-hidden />)}
                <span className="truncate">{title}</span>
                {!readOnly && problems.length > 0 && <StatusPill tone="danger" dot={false} className="h-6">{problems.length === 1 ? '1 to fix' : `${problems.length} to fix`}</StatusPill>}
              </h3>
              {!readOnly && (
                <button type="button" onClick={() => onEdit(step, problems[0]?.[0])} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-label={`Edit ${title}`}>
                  <PenLine className="h-4 w-4" aria-hidden /> {problems.length ? 'Fix' : 'Edit'}
                </button>
              )}
            </div>
            <dl className="divide-y">
              {sections[step].map(([label, value]) => (
                <div key={label} className="grid gap-0.5 px-4 py-2.5 text-[15px] sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4 sm:px-5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 whitespace-pre-line break-words">{value === '' || value == null ? <span className="text-muted-foreground">Not answered</span> : value}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

export function ReviewStep(props: Props) {
  const { form, currency, organizationName, fee, collectOnline, feePaidAt, consent, onConsent, signature, onSignature, signErrors, errorsByStep, children } = props;
  const outstanding = Object.values(errorsByStep).reduce((n, e) => n + Object.keys(e).length, 0);
  const matches = signatureMatches(signature, form.applicantName);
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-8">
      {outstanding > 0 && (
        <Alert tone="warning" title={outstanding === 1 ? 'One answer needs attention before you can submit' : `${outstanding} answers need attention before you can submit`}>
          Use Fix on the sections marked below.
        </Alert>
      )}

      <ApplicationSummary {...props} />

      <section aria-labelledby="sign-heading" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
        <div>
          <h3 id="sign-heading" className="text-base font-semibold">
            Authorize and sign
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Required to submit.</p>
        </div>

        <div data-field="consent">
          <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors', consent ? 'border-primary/40 bg-primary/[0.04]' : 'hover:bg-accent/50', signErrors.consent && !consent && 'border-tone-danger')}>
            <input
              id={fieldId('consent')}
              type="checkbox"
              checked={consent}
              onChange={e => onConsent(e.target.checked)}
              aria-invalid={signErrors.consent ? true : undefined}
              aria-describedby={signErrors.consent ? `${fieldId('consent')}-error` : undefined}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-[hsl(var(--primary))]"
            />
            <span className="text-[15px] leading-relaxed text-foreground/90">
              I authorize {organizationName} to verify the information in this application, contact my references, landlords and employers, and obtain consumer reports — including credit and background checks — to evaluate it. I certify that everything I’ve provided is true and complete.
            </span>
          </label>
          {signErrors.consent && (
            <p id={`${fieldId('consent')}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
              {signErrors.consent}
            </p>
          )}
        </div>

        <div data-field="signature">
          <label htmlFor={fieldId('signature')} className="block text-[15px] font-medium">
            Signature
          </label>
          <p id={`${fieldId('signature')}-hint`} className="mt-0.5 text-sm text-muted-foreground">
            Type your full legal name{form.applicantName.trim() ? <>, <span className="font-medium text-foreground">{form.applicantName.trim()}</span>,</> : ''} to sign.
          </p>
          <div className="relative mt-2 sm:max-w-md">
            <input
              id={fieldId('signature')}
              value={signature}
              onChange={e => onSignature(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              aria-invalid={signErrors.signature ? true : undefined}
              aria-describedby={[signErrors.signature ? `${fieldId('signature')}-error` : '', `${fieldId('signature')}-hint`].filter(Boolean).join(' ')}
              className={inputClass('h-12 pr-10 font-serif text-lg italic')}
            />
            {matches && <CheckCircle2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-tone-success" aria-label="Signature matches" />}
          </div>
          {signErrors.signature ? (
            <p id={`${fieldId('signature')}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
              {signErrors.signature}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">Signed electronically on {today}.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="fee-heading" className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="fee-heading" className="text-base font-semibold">
            Application fee
          </h3>
          <p className="text-lg font-semibold tabular-nums">{fee > 0 ? formatMoney(fee, currency) : 'Free'}</p>
        </div>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {fee <= 0
            ? 'There’s no fee to apply for this home.'
            : feePaidAt
              ? 'Paid. Thank you — it isn’t charged again if you change your answers.'
              : collectOnline
                ? 'Covers screening for everyone on the application. Paid by card now; it’s non-refundable once screening begins.'
                : 'No payment is needed to submit. The fee covers screening and is paid at your showing or lease signing — the leasing team will explain how.'}
        </p>
        {children && <div className="mt-5">{children}</div>}
      </section>
    </div>
  );
}
