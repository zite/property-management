import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, DoorOpen, PawPrint, Phone, Siren } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createMaintenanceRequest } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { CategoryGlyph, LoadError, ResidentSkeleton } from '../../components/resident/bits';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { PhotoPicker, useUploads } from '../../components/resident/uploads';
import { Alert, Button, Card, Container, EmptyState, FieldRow, inputClass, LinkButton, ProgressBar, textareaClass } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { usePortal } from '../../lib/queries';
import { categoryMeta, EMERGENCY_EXAMPLES, PRIORITY_WORDS, REQUEST_CATEGORIES, telHref, URGENCY } from '../../lib/residentFormat';
import { useResidentLease } from '../../lib/residentLease';
import { useRefreshResident, useResidentRequests } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Reporting a problem, one question at a time — built for someone standing in
 * a wet kitchen holding a phone. What's wrong, whether it's an emergency (and
 * the number to call if it is), the details and photos, then how to get in.
 */

type Priority = 'Emergency' | 'High' | 'Normal' | 'Low';
const STEPS = ['What needs fixing', 'How urgent', 'Details', 'Getting in'] as const;

const TITLE_EXAMPLES: Record<string, string> = {
  Plumbing: 'Kitchen sink is leaking under the cabinet',
  Electrical: 'Bedroom outlet stopped working',
  HVAC: 'Heat isn’t coming on',
  Appliance: 'Dishwasher won’t drain',
  'Doors & windows': 'Balcony door won’t latch',
  'Locks & keys': 'Need a replacement mailbox key',
  'Pest control': 'Ants in the kitchen',
  Safety: 'Smoke alarm keeps chirping',
  Flooring: 'Loose tile in the bathroom',
  Painting: 'Water stain on the living room ceiling',
  Roofing: 'Leak from the ceiling when it rains',
  Landscaping: 'Sprinkler is spraying the walkway',
  Cleaning: 'Spill in the hallway outside my door',
  General: 'Describe the problem in a few words',
};

export default function NewRequestPage() {
  useDocumentTitle('New maintenance request');
  const { leaseId, lease } = useResidentLease();
  const portal = usePortal();
  const requests = useResidentRequests(leaseId);
  const navigate = useNavigate();
  const refresh = useRefreshResident();
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<boolean | null>(null);
  const [urgency, setUrgency] = useState<Exclude<Priority, 'Emergency'>>('Normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [permission, setPermission] = useState<boolean | null>(null);
  const [entryNotes, setEntryNotes] = useState('');
  const [hasPets, setHasPets] = useState(false);
  const [pets, setPets] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const uploads = useUploads(6);
  const touched = useRef(false);

  const emergencyPhone = portal.data?.settings.emergencyPhone || portal.data?.settings.phone || '';
  const priority: Priority = emergency ? 'Emergency' : urgency;

  useEffect(() => {
    if (!touched.current) return;
    headingRef.current?.focus();
  }, [step]);

  const create = useMutation({
    mutationFn: () =>
      createMaintenanceRequest({
        leaseId,
        category: category!,
        priority,
        title: title.trim(),
        description: description.trim(),
        photos: uploads.uploaded,
        permissionToEnter: Boolean(permission),
        entryNotes: entryNotes.trim(),
        pets: hasPets ? pets.trim() || 'Yes' : '',
      }),
    onSuccess: res => {
      void refresh();
      toast.success(`Request ${res.ref} sent. We’ll let you know when it’s scheduled.`);
      navigate(`/resident/maintenance/${res.number}`, { replace: true });
    },
  });

  if (requests.isPending || portal.isPending) return <ResidentSkeleton variant="document" />;
  if (requests.isError) return <LoadError error={requests.error} onRetry={() => requests.refetch()} what="the request form" />;
  if (!requests.data?.canRequest) {
    return (
      <Container size="narrow" className="py-14">
        <EmptyState icon={DoorOpen} title="Maintenance requests aren’t open for this lease" action={<LinkButton to="/resident/maintenance" variant="secondary">Back to maintenance</LinkButton>}>
          {lease?.status === 'Pending signature' ? 'You can send requests once your lease starts.' : `Please call the office${portal.data?.settings.phone ? ` at ${portal.data.settings.phone}` : ''} and we’ll help.`}
        </EmptyState>
      </Container>
    );
  }

  const go = (to: number) => {
    touched.current = true;
    setErrors({});
    setStep(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    const e: Record<string, string> = {};
    if (step === 0 && !category) e.category = 'Choose what needs fixing.';
    if (step === 1 && emergency === null) e.emergency = 'Tell us whether this is an emergency.';
    if (step === 2) {
      if (title.trim().length < 3) e.title = 'Give the request a short title.';
      if (uploads.uploading) e.photos = 'Wait for your photos to finish uploading.';
    }
    if (step === 3 && permission === null) e.permission = 'Let us know if we can come in when you’re not home.';
    setErrors(e);
    if (Object.keys(e).length) return;
    if (step < STEPS.length - 1) go(step + 1);
    else create.mutate();
  };

  const meta = category ? categoryMeta(category) : null;

  return (
    <div className="animate-fade-in">
      <ResidentHeader title="New maintenance request" subtitle={<LeaseSwitcher />} back={{ to: '/resident/maintenance', label: 'Maintenance' }} />
      <Container size="narrow" className="pb-4 pt-4">
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Step {step + 1} of {STEPS.length}
            </span>
            <span>{STEPS[step]}</span>
          </div>
          <ProgressBar value={(step + 1) / STEPS.length} label="Progress" />
        </div>

        <form
          noValidate
          onSubmit={e => {
            e.preventDefault();
            next();
          }}
        >
          <Card className="p-5 sm:p-7">
            {step === 0 && (
              <fieldset>
                <legend>
                  <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
                    What needs fixing?
                  </h2>
                </legend>
                <p className="mt-1 text-[15px] text-muted-foreground">Pick the closest match — it helps us send the right person.</p>
                <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {REQUEST_CATEGORIES.map(c => {
                    const selected = category === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setCategory(c.value);
                          go(1);
                        }}
                        className={cn(
                          'group flex min-h-[112px] flex-col items-start gap-2 rounded-xl border bg-background p-3.5 text-left transition-[border-color,background-color,box-shadow] hover:border-foreground/25 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
                          selected && 'border-primary bg-primary/[0.05] ring-1 ring-primary',
                        )}
                      >
                        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground/75 transition-colors', selected && 'bg-primary text-primary-foreground')}>
                          <c.icon className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        <span className="text-[15px] font-medium leading-tight">{c.label}</span>
                        <span className="text-xs leading-snug text-muted-foreground">{c.hint}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.category && <p role="alert" className="mt-3 text-sm text-tone-danger">{errors.category}</p>}
              </fieldset>
            )}

            {step === 1 && (
              <fieldset>
                <legend>
                  <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
                    Is this an emergency?
                  </h2>
                </legend>
                <p className="mt-1 text-[15px] text-muted-foreground">An emergency is something that could hurt someone or damage the building if it waits:</p>
                <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-[15px] sm:grid-cols-2">
                  {EMERGENCY_EXAMPLES.map(x => (
                    <li key={x} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-tone-danger" aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Is this an emergency?">
                  <Choice selected={emergency === true} onSelect={() => setEmergency(true)} tone="danger" title="Yes, it’s an emergency" hint="It can’t wait until tomorrow." />
                  <Choice selected={emergency === false} onSelect={() => setEmergency(false)} title="No, it can wait" hint="It needs fixing, but nobody’s at risk." />
                </div>
                {errors.emergency && <p role="alert" className="mt-3 text-sm text-tone-danger">{errors.emergency}</p>}

                {emergency === true && (
                  <div className="mt-5 rounded-xl border border-tone-danger/30 bg-tone-danger/[0.06] p-4 animate-fade-up" role="alert">
                    <div className="flex gap-3">
                      <Siren className="mt-0.5 h-5 w-5 shrink-0 text-tone-danger" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold">Call us now{emergencyPhone ? ` at ${emergencyPhone}` : ''}</p>
                        <p className="mt-0.5 text-[15px] text-foreground/85">Someone answers day and night. If there’s fire, a gas smell or anyone is hurt, get out and call 911 first. You can still finish this request so we have the details and photos.</p>
                        {emergencyPhone && (
                          <a href={telHref(emergencyPhone)} className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-tone-danger px-4 text-[15px] font-medium text-white shadow-xs hover:bg-tone-danger/90 dark:text-[hsl(240_10%_6%)]">
                            <Phone className="h-4 w-4" aria-hidden /> Call {emergencyPhone}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {emergency === false && (
                  <div className="mt-6 animate-fade-up">
                    <p className="text-[15px] font-medium" id={`${id}-urgency`}>
                      How soon does it need attention?
                    </p>
                    <div className="mt-2.5 space-y-2" role="radiogroup" aria-labelledby={`${id}-urgency`}>
                      {URGENCY.map(u => (
                        <Choice key={u.value} compact selected={urgency === u.value} onSelect={() => setUrgency(u.value)} title={u.label} hint={u.hint} />
                      ))}
                    </div>
                  </div>
                )}
              </fieldset>
            )}

            {step === 2 && (
              <div>
                <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-3 text-xl font-semibold tracking-tight outline-none">
                  {meta && <CategoryGlyph category={meta.value} size="sm" />}
                  Tell us about it
                </h2>
                <div className="mt-5 space-y-5">
                  <FieldRow id={`${id}-title`} label="Short title" error={errors.title}>
                    <input
                      id={`${id}-title`}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      maxLength={120}
                      placeholder={`e.g. ${TITLE_EXAMPLES[category ?? 'General']}`}
                      aria-invalid={Boolean(errors.title) || undefined}
                      className={inputClass()}
                      autoFocus={!touched.current}
                    />
                  </FieldRow>
                  <FieldRow id={`${id}-description`} label="What’s happening?" hint="Where it is, when it started, anything you’ve tried." optional>
                    <textarea id={`${id}-description`} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} className={textareaClass('min-h-[128px]')} />
                  </FieldRow>
                  <FieldRow id={`${id}-photos`} label="Photos" hint="A photo or two often saves a visit. Up to 6." optional error={errors.photos}>
                    <PhotoPicker uploads={uploads} max={6} id={`${id}-photos`} />
                  </FieldRow>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
                  Getting in
                </h2>
                <p className="mt-1 text-[15px] text-muted-foreground">We always knock and announce ourselves before coming in.</p>
                <fieldset className="mt-5">
                  <legend className="text-[15px] font-medium">Can we enter if you’re not home?</legend>
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Permission to enter">
                    <Choice selected={permission === true} onSelect={() => setPermission(true)} title="Yes, come on in" hint="Fastest — no need to coordinate." compact />
                    <Choice selected={permission === false} onSelect={() => setPermission(false)} title="No, contact me first" hint="We’ll arrange a time with you." compact />
                  </div>
                  {errors.permission && <p role="alert" className="mt-2 text-sm text-tone-danger">{errors.permission}</p>}
                </fieldset>
                <div className="mt-5 space-y-5">
                  <FieldRow id={`${id}-entry`} label="Anything we should know?" hint="Alarm codes, best times, a sleeping baby." optional>
                    <textarea id={`${id}-entry`} value={entryNotes} onChange={e => setEntryNotes(e.target.value)} maxLength={500} className={textareaClass('min-h-[88px]')} />
                  </FieldRow>
                  <div>
                    <label className="flex cursor-pointer items-center gap-3 text-[15px] font-medium">
                      <input type="checkbox" checked={hasPets} onChange={e => setHasPets(e.target.checked)} className="h-5 w-5 rounded accent-[hsl(var(--primary))]" />
                      <PawPrint className="h-4 w-4 text-muted-foreground" aria-hidden /> There are pets at home
                    </label>
                    {hasPets && (
                      <input value={pets} onChange={e => setPets(e.target.value)} maxLength={200} placeholder="e.g. One friendly dog, crated during the visit" aria-label="About your pets" className={inputClass('mt-2.5')} />
                    )}
                  </div>
                </div>

                <div className="mt-6 rounded-xl border bg-subtle p-4">
                  <p className="text-sm font-medium text-muted-foreground">Your request</p>
                  <p className="mt-1 text-[15px] font-semibold">{title.trim() || 'Untitled'}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {meta?.label} · {PRIORITY_WORDS[priority]}
                    {uploads.uploaded.length ? ` · ${uploads.uploaded.length} photo${uploads.uploaded.length === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                {create.isError && (
                  <Alert tone="danger" className="mt-4">
                    {errorMessage(create.error, 'Your request didn’t send. Try again.')}
                  </Alert>
                )}
              </div>
            )}

            <div className="mt-7 flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => go(step - 1)} disabled={create.isPending}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
              ) : (
                <LinkButton to="/resident/maintenance" variant="ghost">
                  Cancel
                </LinkButton>
              )}
              {step > 0 && (
                <Button type="submit" size="lg" loading={create.isPending} disabled={step === 2 && uploads.uploading} className="sm:min-w-[160px]">
                  {step === STEPS.length - 1 ? (
                    <>
                      {!create.isPending && <Check aria-hidden />} Send request
                    </>
                  ) : (
                    <>
                      Continue <ArrowRight aria-hidden />
                    </>
                  )}
                </Button>
              )}
            </div>
          </Card>
        </form>
      </Container>
    </div>
  );
}

function Choice({ selected, onSelect, title, hint, tone, compact }: { selected: boolean; onSelect: () => void; title: string; hint: string; tone?: 'danger'; compact?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border bg-background text-left transition-[border-color,background-color] hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
        compact ? 'p-3.5' : 'p-4',
        selected && (tone === 'danger' ? 'border-tone-danger bg-tone-danger/[0.05] ring-1 ring-tone-danger' : 'border-primary bg-primary/[0.04] ring-1 ring-primary'),
      )}
    >
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', selected ? (tone === 'danger' ? 'border-tone-danger' : 'border-primary') : 'border-input')} aria-hidden>
        {selected && <span className={cn('h-2.5 w-2.5 rounded-full', tone === 'danger' ? 'bg-tone-danger' : 'bg-primary')} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
