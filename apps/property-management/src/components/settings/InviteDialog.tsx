import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { inviteTeamMember } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { ROLES, type Role } from '@project/shared/constants';
import { ROLE_DESCRIPTIONS } from '@project/shared/roles';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { Field, FieldRow, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Invite a teammate: email, role, and optionally their name and title. They
 * get an email with a link to sign in; the role is theirs the moment they do.
 */
export function InviteDialog({ open, onOpenChange, defaultRole }: { open: boolean; onOpenChange: (open: boolean) => void; defaultRole: Role }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(defaultRole);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<{ email?: string; name?: string; title?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole(defaultRole);
    setName('');
    setTitle('');
    setErrors({});
  }, [open, defaultRole]);

  const submit = async () => {
    const e: typeof errors = {};
    const clean = email.trim().toLowerCase();
    if (!clean) e.email = 'Enter their work email.';
    else if (!EMAIL_RE.test(clean)) e.email = 'That doesn’t look like an email address.';
    if (name.length > 80) e.name = 'Keep the name under 80 characters.';
    if (title.length > 80) e.title = 'Keep the title under 80 characters.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setPending(true);
    try {
      const res = await inviteTeamMember({ email: clean, role, name: name.trim() || undefined, title: title.trim() || undefined });
      invalidate(qc, 'settings', 'bootstrap');
      onOpenChange(false);
      if (res.delivery === 'Sent') {
        toast.success(`Invite sent to ${clean}`, { description: `They’ll have the ${role} role when they sign in.` });
      } else {
        toast.warning(`${clean} was added, but the invite email didn’t send`, {
          description: 'Send them the sign-in link yourself.',
          action: { label: 'Copy link', onClick: () => void copyText(appUrl('/home'), 'Sign-in link copied') },
          duration: 10_000,
        });
      }
    } catch (err) {
      const msg = errorMessage(err, 'The invite didn’t go through. Try again.');
      if (/already/i.test(msg)) setErrors({ email: msg });
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Invite a teammate" description="They’ll get an email with a link to sign in." onSubmit={submit} pending={pending} submitLabel="Send invite">
      <div className="space-y-4">
        <Field label="Email" htmlFor="invite-email" error={errors.email}>
          <TextInput id="invite-email" type="text" inputMode="email" autoCapitalize="off" spellCheck={false} autoComplete="off" value={email} invalid={Boolean(errors.email)} onChange={e => setEmail(e.target.value)} placeholder="name@yourcompany.com" data-autofocus />
        </Field>
        <Field label="Role">
          <div role="radiogroup" aria-label="Role" className="overflow-hidden rounded-lg border">
            {ROLES.map(r => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn('flex w-full items-start gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent/50', role === r && 'bg-accent/60')}
              >
                <span className={cn('mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', role === r ? 'border-primary' : 'border-input')}>
                  {role === r && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{r}</span>
                  <span className="block text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
                </span>
              </button>
            ))}
          </div>
        </Field>
        <FieldRow>
          <Field label="Name" optional htmlFor="invite-name" error={errors.name}>
            <TextInput id="invite-name" value={name} onChange={e => setName(e.target.value)} placeholder="Renata Ortiz" />
          </Field>
          <Field label="Title" optional htmlFor="invite-title" error={errors.title}>
            <TextInput id="invite-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Property Manager" />
          </Field>
        </FieldRow>
      </div>
    </FormDialog>
  );
}
