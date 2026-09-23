import { Plus, Trash2, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { LIMITS, emptyCoApplicant, emptyReference, householdIncome, type ApplicationForm, type Errors, type StepId } from '../../lib/applyRules';
import { formatMoney } from '../../lib/format';
import { Alert, Button } from '../ui';
import { CountField, DateField, DurationField, MoneyField, PhoneField, TextAreaField, TextField, YesNoField } from './fields';

export type StepProps = {
  form: ApplicationForm;
  errors: Errors;
  update: (patch: Partial<ApplicationForm>) => void;
  email: string;
  today: string;
  rent: number | null;
  incomeMultiple: number;
  currency: string;
};

/** The questions on each step of the rental application. Validation lives in `lib/applyRules`. */
export function StepFields({ step, ...props }: StepProps & { step: StepId }) {
  switch (step) {
    case 'about':
      return <About {...props} />;
    case 'residence':
      return <Residence {...props} />;
    case 'income':
      return <Income {...props} />;
    case 'household':
      return <Household {...props} />;
    case 'references':
      return <References {...props} />;
    default:
      return null;
  }
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = `group-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section role="group" aria-labelledby={id} className="space-y-5 border-t pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 id={id} className="text-base font-semibold">
          {title}
        </h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function About({ form, errors, update, email, today }: StepProps) {
  const max = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  return (
    <div className="space-y-5">
      <TextField name="applicantName" label="Full legal name" hint="As it appears on your government ID." value={form.applicantName} onChange={applicantName => update({ applicantName })} error={errors.applicantName} inputProps={{ autoComplete: 'name', maxLength: LIMITS.name }} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField name="email" label="Email" hint="Your application is tied to the email you signed in with." value={email} onChange={() => undefined} disabled inputProps={{ readOnly: true }} />
        <PhoneField name="phone" label="Phone" value={form.phone} onChange={phone => update({ phone })} error={errors.phone} />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <DateField name="desiredMoveIn" label="Desired move-in date" value={form.desiredMoveIn} min={today} max={max} onChange={desiredMoveIn => update({ desiredMoveIn })} error={errors.desiredMoveIn} />
        <CountField name="occupants" label="People living in the home" hint="Including you and any children." value={form.occupants} onChange={occupants => update({ occupants })} error={errors.occupants} />
      </div>
    </div>
  );
}

function Residence({ form, errors, update }: StepProps) {
  const rents = (form.currentRent ?? 0) > 0;
  return (
    <div className="space-y-5">
      <TextAreaField name="currentAddress" label="Current address" hint="Street, unit, city, state and ZIP." rows={2} maxLength={LIMITS.address} value={form.currentAddress} onChange={currentAddress => update({ currentAddress })} error={errors.currentAddress} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <MoneyField name="currentRent" label="Monthly rent" hint="Enter 0 if you own or don’t pay rent." suffix="/ month" value={form.currentRent} onChange={currentRent => update({ currentRent })} error={errors.currentRent} />
        <DurationField name="residenceMonths" label="How long you’ve lived there" value={form.residenceMonths} onChange={residenceMonths => update({ residenceMonths })} error={errors.residenceMonths} />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField
          name="currentLandlord"
          label="Landlord or property manager"
          optional={!rents}
          value={form.currentLandlord}
          onChange={currentLandlord => update({ currentLandlord })}
          error={errors.currentLandlord}
          inputProps={{ maxLength: LIMITS.name }}
        />
        <PhoneField name="landlordPhone" label="Landlord’s phone" optional={!rents} value={form.landlordPhone} onChange={landlordPhone => update({ landlordPhone })} error={errors.landlordPhone} />
      </div>
      <TextAreaField name="reasonForMoving" label="Why are you moving?" rows={2} maxLength={LIMITS.text} placeholder="Closer to work, need more space, lease ending…" value={form.reasonForMoving} onChange={reasonForMoving => update({ reasonForMoving })} error={errors.reasonForMoving} />
      <YesNoField name="priorEviction" label="Have you ever been evicted?" hint="Answer honestly — a past eviction doesn’t automatically disqualify you." value={form.priorEviction} onChange={priorEviction => update({ priorEviction })} error={errors.priorEviction} />
    </div>
  );
}

function Income({ form, errors, update, rent, incomeMultiple, currency }: StepProps) {
  const household = householdIncome(form);
  const target = rent && incomeMultiple > 0 ? rent * incomeMultiple : null;
  const showNote = target != null && form.monthlyIncome != null && household < target;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField name="employer" label="Employer" hint="Self-employed, retired or a student? Say so here." value={form.employer} onChange={employer => update({ employer })} error={errors.employer} inputProps={{ autoComplete: 'organization', maxLength: LIMITS.name }} />
        <TextField name="jobTitle" label="Job title" value={form.jobTitle} onChange={jobTitle => update({ jobTitle })} error={errors.jobTitle} inputProps={{ autoComplete: 'organization-title', maxLength: LIMITS.name }} />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <DurationField name="employmentMonths" label="How long you’ve worked there" value={form.employmentMonths} onChange={employmentMonths => update({ employmentMonths })} error={errors.employmentMonths} />
        <MoneyField name="monthlyIncome" label="Gross monthly income" hint="Before taxes, from all sources." suffix="/ month" value={form.monthlyIncome} onChange={monthlyIncome => update({ monthlyIncome })} error={errors.monthlyIncome} />
      </div>
      {showNote && (
        <Alert tone="info" title="You can still apply">
          We usually look for household income of about {incomeMultiple}× the rent ({formatMoney(target!, currency, { cents: false })} a month). Income from co-applicants on the next step counts toward that, and savings or a guarantor can help too.
        </Alert>
      )}
    </div>
  );
}

function Household({ form, errors, update }: StepProps) {
  const setCo = (i: number, patch: Partial<ApplicationForm['coApplicants'][number]>) => update({ coApplicants: form.coApplicants.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-8">
      <Group
        title="Co-applicants"
        description="Every other adult who will live in the home and sign the lease. Each will be screened."
      >
        {form.coApplicants.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-4 text-[15px] text-muted-foreground">
            <Users className="h-5 w-5 shrink-0" aria-hidden />
            <span>Just you. Add a partner, roommate or other adult if they’ll be on the lease.</span>
          </div>
        ) : (
          <ol className="space-y-4">
            {form.coApplicants.map((c, i) => (
              <li key={i} className="rounded-xl border bg-subtle p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="font-medium">{c.name.trim() || `Co-applicant ${i + 1}`}</p>
                  <Button variant="ghost" size="sm" className="-mr-2 text-muted-foreground hover:text-tone-danger" onClick={() => update({ coApplicants: form.coApplicants.filter((_, j) => j !== i) })} aria-label={`Remove ${c.name.trim() || `co-applicant ${i + 1}`}`}>
                    <Trash2 aria-hidden /> Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField name={`coApplicants.${i}.name`} label="Full name" value={c.name} onChange={name => setCo(i, { name })} error={errors[`coApplicants.${i}.name`]} inputProps={{ maxLength: LIMITS.name }} />
                  <TextField name={`coApplicants.${i}.email`} label="Email" value={c.email} onChange={email => setCo(i, { email })} error={errors[`coApplicants.${i}.email`]} inputProps={{ type: 'email', inputMode: 'email', maxLength: LIMITS.email }} />
                  <TextField name={`coApplicants.${i}.relationship`} label="Relationship to you" value={c.relationship} onChange={relationship => setCo(i, { relationship })} error={errors[`coApplicants.${i}.relationship`]} inputProps={{ placeholder: 'Spouse, partner, roommate…', maxLength: LIMITS.name }} />
                  <TextField name={`coApplicants.${i}.employer`} label="Employer" optional value={c.employer} onChange={employer => setCo(i, { employer })} error={errors[`coApplicants.${i}.employer`]} inputProps={{ maxLength: LIMITS.name }} />
                  <MoneyField name={`coApplicants.${i}.monthlyIncome`} label="Gross monthly income" optional suffix="/ month" value={c.monthlyIncome} onChange={monthlyIncome => setCo(i, { monthlyIncome })} error={errors[`coApplicants.${i}.monthlyIncome`]} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {form.coApplicants.length < LIMITS.coApplicants && (
          <Button variant="secondary" onClick={() => update({ coApplicants: [...form.coApplicants, emptyCoApplicant()] })}>
            <Plus aria-hidden /> Add a co-applicant
          </Button>
        )}
      </Group>

      <Group title="Pets">
        <YesNoField name="hasPets" label="Will any pets live with you?" hint="Assistance animals aren’t pets — you don’t need to list them here." value={form.hasPets} onChange={hasPets => update({ hasPets })} error={errors.hasPets} />
        {form.hasPets && <TextAreaField name="pets" label="Tell us about them" rows={2} placeholder="Dog — Pepper, beagle mix, 18 lb" value={form.pets} onChange={pets => update({ pets })} error={errors.pets} />}
      </Group>

      <Group title="Vehicles">
        <YesNoField name="hasVehicles" label="Will you park any vehicles here?" value={form.hasVehicles} onChange={hasVehicles => update({ hasVehicles })} error={errors.hasVehicles} />
        {form.hasVehicles && <TextAreaField name="vehicles" label="Year, make and model" rows={2} placeholder="2019 Toyota RAV4, blue" value={form.vehicles} onChange={vehicles => update({ vehicles })} error={errors.vehicles} />}
      </Group>
    </div>
  );
}

function References({ form, errors, update }: StepProps) {
  const setRef = (i: number, patch: Partial<ApplicationForm['references'][number]>) => update({ references: form.references.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-8">
      <Group title="References" description="A past landlord, employer or someone who has known you for a while. Not a family member.">
        {errors.references && <p className="text-sm text-tone-danger" role="alert">{errors.references}</p>}
        <ol className="space-y-4">
          {form.references.map((r, i) => (
            <li key={i} className="rounded-xl border bg-subtle p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="font-medium">{r.name.trim() || `Reference ${i + 1}`}</p>
                {form.references.length > 1 && (
                  <Button variant="ghost" size="sm" className="-mr-2 text-muted-foreground hover:text-tone-danger" onClick={() => update({ references: form.references.filter((_, j) => j !== i) })} aria-label={`Remove ${r.name.trim() || `reference ${i + 1}`}`}>
                    <Trash2 aria-hidden /> Remove
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField name={`references.${i}.name`} label="Name" value={r.name} onChange={name => setRef(i, { name })} error={errors[`references.${i}.name`]} inputProps={{ maxLength: LIMITS.name }} />
                <TextField name={`references.${i}.relationship`} label="How you know them" value={r.relationship} onChange={relationship => setRef(i, { relationship })} error={errors[`references.${i}.relationship`]} inputProps={{ placeholder: 'Former landlord, manager…', maxLength: LIMITS.name }} />
                <PhoneField name={`references.${i}.phone`} label="Phone" value={r.phone} onChange={phone => setRef(i, { phone })} error={errors[`references.${i}.phone`]} />
                <TextField name={`references.${i}.email`} label="Email" optional value={r.email} onChange={email => setRef(i, { email })} error={errors[`references.${i}.email`]} inputProps={{ type: 'email', inputMode: 'email', maxLength: LIMITS.email }} />
              </div>
            </li>
          ))}
        </ol>
        {form.references.length < LIMITS.references && (
          <Button variant="secondary" onClick={() => update({ references: [...form.references, emptyReference()] })}>
            <Plus aria-hidden /> Add another reference
          </Button>
        )}
      </Group>

      <Group title="Emergency contact" description="Someone we can call if we can’t reach you in an emergency.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="emergencyContact.name" label="Name" value={form.emergencyContact.name} onChange={name => update({ emergencyContact: { ...form.emergencyContact, name } })} error={errors['emergencyContact.name']} inputProps={{ maxLength: LIMITS.name }} />
          <TextField name="emergencyContact.relationship" label="Relationship" optional value={form.emergencyContact.relationship} onChange={relationship => update({ emergencyContact: { ...form.emergencyContact, relationship } })} error={errors['emergencyContact.relationship']} inputProps={{ placeholder: 'Parent, sibling, friend…', maxLength: LIMITS.name }} />
          <PhoneField name="emergencyContact.phone" label="Phone" value={form.emergencyContact.phone} onChange={phone => update({ emergencyContact: { ...form.emergencyContact, phone } })} error={errors['emergencyContact.phone']} />
        </div>
      </Group>
    </div>
  );
}
