import { useMutation } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createInquiry } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { useSession } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { useMe, usePortal } from '../../lib/queries';
import { Alert, Button, FieldRow, inputClass, textareaClass } from '../ui';
import { Segmented } from './controls';

type Kind = 'question' | 'showing';
type Draft = { name: string; email: string; phone: string; message: string; availability: string; desiredMoveIn: string; website: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Ask about a home or ask to see it. Anyone can send one — no account — so the
 * form asks only for what the leasing team needs to reply, checks it before
 * sending, and ends on a clear "we've got it" rather than a toast that vanishes.
 */
export function InquiryDialog({ open, onOpenChange, slug, listingTitle, initialKind = 'question', showingInstructions }: { open: boolean; onOpenChange: (o: boolean) => void; slug: string; listingTitle: string; initialKind?: Kind; showingInstructions?: string }) {
  const { user, name } = useSession();
  const me = useMe();
  const portal = usePortal();
  const id = useId();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [draft, setDraft] = useState<Draft>({ name: '', email: '', phone: '', message: '', availability: '', desiredMoveIn: '', website: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [done, setDone] = useState<{ status: 'received' | 'updated'; firstName: string; email: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setErrors({});
    setDone(null);
    send.reset();
    setDraft(d => ({ ...d, name: d.name || me.data?.name || (user ? name : '') || '', email: d.email || user?.email || '', message: '', availability: '', website: '' }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => createInquiry({ slug, kind, name: draft.name, email: draft.email, phone: draft.phone, message: draft.message, availability: draft.availability, desiredMoveIn: draft.desiredMoveIn, website: draft.website }),
    onSuccess: res => setDone({ ...res, email: draft.email.trim() }),
  });

  const set = (k: keyof Draft, v: string) => {
    setDraft(d => ({ ...d, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (draft.name.trim().length < 2) e.name = 'Enter your name so we know who to reply to.';
    if (!draft.email.trim()) e.email = 'Enter your email so we can reply.';
    else if (!EMAIL_RE.test(draft.email.trim())) e.email = 'Enter a valid email address.';
    const digits = draft.phone.replace(/\D/g, '');
    if (draft.phone.trim() && (digits.length < 10 || digits.length > 15)) e.phone = 'Enter a phone number with area code, or leave it blank.';
    if (kind === 'question' && draft.message.trim().length < 2) e.message = 'Write your question.';
    if (kind === 'showing' && !draft.availability.trim() && draft.message.trim().length < 2) e.availability = 'Tell us a few days and times that work for you.';
    if (draft.desiredMoveIn && draft.desiredMoveIn < localToday()) e.desiredMoveIn = 'Choose a date that’s today or later.';
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) document.getElementById(`${id}-${first}`)?.focus();
    return !first;
  };

  const field = (k: keyof Draft) => ({
    id: `${id}-${k}`,
    value: draft[k],
    'aria-invalid': Boolean(errors[k]) || undefined,
    'aria-describedby': errors[k] ? `${id}-${k}-error` : undefined,
  });

  const org = portal.data?.settings.organizationName ?? 'The leasing team';

  return (
    <Dialog open={open} onOpenChange={o => !send.isPending && onOpenChange(o)}>
      <DialogContent
        className="w-[calc(100%-1.5rem)] max-w-lg gap-0 rounded-2xl p-0"
        onOpenAutoFocus={e => {
          e.preventDefault();
          // Signed-in people already have their name and email filled in, so start them at the question.
          window.setTimeout(() => (user ? document.getElementById(`${id}-${initialKind === 'showing' ? 'availability' : 'message'}`) ?? nameRef.current : nameRef.current)?.focus(), 30);
        }}
      >
        {done ? (
          <div className="px-6 pb-6 pt-8 text-center sm:px-8">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tone-success/10 text-tone-success animate-pop">
              <CheckCircle2 className="h-6 w-6" aria-hidden />
            </span>
            <DialogTitle className="mt-4 text-xl font-semibold">{done.status === 'updated' ? 'Added to your earlier message' : kind === 'showing' ? 'Showing request sent' : 'Message sent'}</DialogTitle>
            <DialogDescription asChild>
              <div className="mx-auto mt-2 max-w-sm text-[15px] text-muted-foreground">
                <p>
                  Thanks{done.firstName ? `, ${done.firstName}` : ''}. {org} will reply to <span className="font-medium text-foreground">{done.email}</span>
                  {kind === 'showing' ? ' to confirm a time.' : ', usually within one business day.'}
                </p>
              </div>
            </DialogDescription>
            <Button variant="secondary" className="mt-6 w-full sm:w-auto" onClick={() => onOpenChange(false)} autoFocus>
              Done
            </Button>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={e => {
              e.preventDefault();
              if (send.isPending) return;
              if (validate()) send.mutate();
            }}
          >
            <div className="border-b px-6 pb-4 pt-6 sm:px-7">
              <DialogTitle className="pr-8 text-lg font-semibold leading-snug">Contact the leasing team</DialogTitle>
              <DialogDescription className="mt-1 line-clamp-2 text-sm text-muted-foreground">About {listingTitle}</DialogDescription>
              <Segmented
                label="What would you like to do?"
                className="mt-4 flex w-full"
                options={[
                  { id: 'question', label: <span className="inline-flex items-center gap-1.5"><MessageCircleQuestion className="h-4 w-4" aria-hidden />Ask a question</span> },
                  { id: 'showing', label: <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" aria-hidden />Request a showing</span> },
                ]}
                value={kind}
                onChange={v => setKind(v as Kind)}
              />
            </div>

            <div className="max-h-[calc(90vh-15rem)] space-y-4 overflow-y-auto px-6 py-5 sm:px-7">
              {kind === 'showing' && showingInstructions && <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-foreground/85">{showingInstructions}</p>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldRow id={`${id}-name`} label="Your name" error={errors.name}>
                  <input ref={nameRef} {...field('name')} onChange={e => set('name', e.target.value)} autoComplete="name" maxLength={120} className={inputClass()} />
                </FieldRow>
                <FieldRow id={`${id}-phone`} label="Phone" optional error={errors.phone}>
                  <input {...field('phone')} onChange={e => set('phone', e.target.value)} type="tel" inputMode="tel" autoComplete="tel" maxLength={40} className={inputClass()} />
                </FieldRow>
              </div>
              <FieldRow id={`${id}-email`} label="Email" error={errors.email}>
                <input {...field('email')} onChange={e => set('email', e.target.value)} type="email" inputMode="email" autoComplete="email" maxLength={254} className={inputClass()} />
              </FieldRow>
              {kind === 'showing' && (
                <FieldRow id={`${id}-availability`} label="When works for you?" hint="A few days and times, like “weekday evenings” or “Saturday morning”." error={errors.availability}>
                  <input {...field('availability')} onChange={e => set('availability', e.target.value)} maxLength={300} className={inputClass()} />
                </FieldRow>
              )}
              <FieldRow id={`${id}-message`} label={kind === 'showing' ? 'Anything else?' : 'Your question'} optional={kind === 'showing'} error={errors.message}>
                <textarea
                  {...field('message')}
                  onChange={e => set('message', e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                    }
                  }}
                  maxLength={3000}
                  placeholder={kind === 'showing' ? 'Questions for your visit, who’s coming…' : 'Is parking included? Can I bring my dog?'}
                  className={textareaClass('min-h-[96px]')}
                />
              </FieldRow>
              <FieldRow id={`${id}-desiredMoveIn`} label="Preferred move-in date" optional error={errors.desiredMoveIn}>
                <input {...field('desiredMoveIn')} onChange={e => set('desiredMoveIn', e.target.value)} type="date" min={localToday()} className={inputClass('sm:w-60')} />
              </FieldRow>
              {/* Honeypot — people never see or fill this. */}
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor={`${id}-website`}>Website</label>
                <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" value={draft.website} onChange={e => set('website', e.target.value)} />
              </div>
              {send.isError && (
                <Alert tone="danger" title="Your message wasn’t sent">
                  {errorMessage(send.error, 'Check your connection and try again.')}
                </Alert>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={send.isPending}>
                {kind === 'showing' ? 'Request showing' : 'Send question'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
