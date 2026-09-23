import { useQueryClient } from '@tanstack/react-query';
import { Keyboard, Laptop, Moon, Sun } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { updateMyProfile } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { ROLE_DESCRIPTIONS } from '@project/shared/roles';
import type { Role } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { useTheme, type ThemePref } from '../../lib/theme';
import { useWorkspace } from '../../lib/workspace';
import { TextInput } from '../form/fields';
import { Kbd } from '../primitives/bits';
import { ImageUpload } from './controls';
import { Group, Row, SaveBar, SectionHeader, useDraft, useUnsavedGuard } from './form';

type ProfileDraft = { name: string; title: string; phone: string; avatarUrl: string | null };

/** Settings → Profile (everyone): name, title, phone, photo, theme and keyboard shortcuts. */
export default function ProfileSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const { pref, setPref } = useTheme();
  const me = ws.memberById.get(ws.me.id);
  const saved = useMemo<ProfileDraft>(() => ({ name: me?.name ?? ws.me.name, title: me?.title ?? '', phone: me?.phone ?? '', avatarUrl: me?.avatarUrl ?? null }), [me, ws.me.name]);
  const form = useDraft<ProfileDraft>('profile', saved);
  useUnsavedGuard({ key: 'profile', label: 'your profile', dirty: form.dirty, draft: form.draft, changed: form.changed, discard: form.discard });
  const [pending, setPending] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const d = form.draft ?? saved;

  const errors = {
    name: !d.name.trim() ? 'Enter your name.' : d.name.length > 80 ? 'Keep your name under 80 characters.' : null,
    title: d.title.length > 80 ? 'Keep your title under 80 characters.' : null,
    phone: d.phone.length > 40 ? 'Keep the phone number under 40 characters.' : null,
  };
  const visible = (k: keyof typeof errors) => (showErrors || k in form.changed ? errors[k] : null);
  const errorCount = Object.values(errors).filter(Boolean).length;

  const save = async () => {
    if (errorCount) return setShowErrors(true);
    setPending(true);
    try {
      await updateMyProfile({ name: d.name.trim(), title: d.title.trim(), phone: d.phone.trim(), avatarUrl: d.avatarUrl });
      form.commit();
      setShowErrors(false);
      await qc.invalidateQueries({ queryKey: ['bootstrap'] });
      invalidate(qc, 'settings');
      toast.success('Profile saved');
    } catch (e) {
      toast.error(errorMessage(e, 'Your profile wasn’t saved. Try again.'));
    } finally {
      setPending(false);
    }
  };

  const themes: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ];

  return (
    <>
      <SectionHeader title="Profile" description="How you appear to your team — on assignments, notes and messages — and how the app looks for you." />

      <Group title="You">
        <Row label="Photo">
          <ImageUpload value={d.avatarUrl} onChange={v => form.set('avatarUrl', v)} name={d.name} color={me?.color} round label="photo" />
        </Row>
        <Row label="Name" htmlFor="profile-name" error={visible('name')}>
          <TextInput id="profile-name" value={d.name} invalid={Boolean(visible('name'))} onChange={e => form.set('name', e.target.value)} maxLength={80} autoComplete="name" />
        </Row>
        <Row label="Title" htmlFor="profile-title" error={visible('title')} description="Shown next to your name, like “Senior Property Manager”.">
          <TextInput id="profile-title" value={d.title} onChange={e => form.set('title', e.target.value)} maxLength={80} placeholder="Property Manager" />
        </Row>
        <Row label="Phone" htmlFor="profile-phone" error={visible('phone')} description="So teammates and vendors can reach you.">
          <TextInput id="profile-phone" type="tel" value={d.phone} onChange={e => form.set('phone', e.target.value)} maxLength={40} placeholder="(303) 555-0140" autoComplete="tel" />
        </Row>
        <Row label="Email" description="The address you sign in with. It can’t be changed here.">
          <div className="field items-center truncate bg-subtle text-muted-foreground">{ws.me.email}</div>
        </Row>
        <Row label="Role" description={ROLE_DESCRIPTIONS[ws.me.role as Role]}>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="text-[14px] font-medium">{ws.me.role}</span>
            {ws.can('members.manage') ? (
              <Link to="/settings/roles" className="text-sm text-muted-foreground hover:text-foreground">See permissions</Link>
            ) : (
              <span className="text-sm text-muted-foreground">An admin can change it</span>
            )}
          </div>
        </Row>
      </Group>

      <Group title="Interface">
        <Row label="Theme" description="Applies straight away, on this device.">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1.5">
            {themes.map(t => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={pref === t.value}
                onClick={() => setPref(t.value)}
                className={cn('flex h-[60px] flex-col items-center justify-center gap-1.5 rounded-md border text-[13px] transition-colors', pref === t.value ? 'border-primary bg-primary/[0.06] font-medium text-foreground ring-1 ring-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Keyboard shortcuts" description="This app is built to be driven from the keyboard.">
          <div className="flex sm:justify-end">
            <button type="button" onClick={() => app.openShortcuts()} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-[14px] shadow-2xs hover:bg-accent">
              <Keyboard className="h-3.5 w-3.5 text-muted-foreground" /> View shortcuts <Kbd>?</Kbd>
            </button>
          </div>
        </Row>
      </Group>

      <SaveBar dirty={form.dirty} pending={pending} errorCount={showErrors ? errorCount : 0} onSave={() => void save()} onDiscard={form.discard} />
    </>
  );
}
