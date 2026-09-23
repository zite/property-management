import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Link2, Mail, MoreHorizontal, Pencil, Plus, UserCheck, UserMinus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { updateTeamMember } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { ROLES, type Role } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, plural, timeAgo } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { Field, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { Avatar } from '../primitives/Avatar';
import { EmptyState, Tip } from '../primitives/bits';
import { Pill } from '../primitives/glyphs';
import { sk, useTeam, type TeamMember } from './data';
import { Group, OrgSettingsForm, Row, SectionError, SectionHeader, SectionSkeleton } from './form';
import { InviteDialog } from './InviteDialog';

type Filter = 'all' | 'Active' | 'Invited' | 'Deactivated';

const FIELDS = ['defaultRole'] as const;

/** Settings → Team: everyone with access, their roles, invites, and who joins by default. */
export default function TeamSection() {
  const [inviting, setInviting] = useState(false);
  return (
    <OrgSettingsForm
      section="team"
      fields={FIELDS}
      header={
        <SectionHeader
          title="Team"
          description="Invite teammates, change what they can do, and remove access when someone leaves."
          action={
            <button type="button" onClick={() => setInviting(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> Invite
            </button>
          }
        />
      }
    >
      {({ draft, set }) => (
        <>
          <Members onInvite={() => setInviting(true)} />
          <Group title="New sign-ins" className="mt-9">
            <Row label="Default role" description="Anyone in your Zite workspace who opens this app without an invite joins with this role. Invite people to choose their role up front.">
              <ChoicePicker
                options={ROLES.filter(r => r !== 'Admin') as Array<Exclude<Role, 'Admin'>>}
                value={draft.defaultRole}
                onChange={v => set('defaultRole', v)}
                align="end"
                trigger={<FieldButton aria-label="Default role">{draft.defaultRole}</FieldButton>}
              />
            </Row>
          </Group>
          <InviteDialog open={inviting} onOpenChange={setInviting} defaultRole={draft.defaultRole} />
        </>
      )}
    </OrgSettingsForm>
  );
}

const STATUS_TONE = { Active: 'success', Invited: 'info', Deactivated: 'neutral' } as const;

function useMemberActions() {
  const qc = useQueryClient();
  return async (member: TeamMember, input: Parameters<typeof updateTeamMember>[0], optimistic: Partial<TeamMember>, success?: string) => {
    const prev = qc.getQueryData<{ members: TeamMember[]; meId: string }>(sk.team);
    qc.setQueryData<{ members: TeamMember[]; meId: string }>(sk.team, old => (old ? { ...old, members: old.members.map(m => (m.id === member.id ? { ...m, ...optimistic } : m)) } : old));
    try {
      const res = await updateTeamMember(input);
      qc.setQueryData<{ members: TeamMember[]; meId: string }>(sk.team, old => (old ? { ...old, members: old.members.map(m => (m.id === member.id ? { ...m, status: res.status, role: res.role } : m)) } : old));
      invalidate(qc, 'bootstrap');
      if (success) toast.success(success);
      return res;
    } catch (e) {
      qc.setQueryData(sk.team, prev);
      toast.error(errorMessage(e, 'That change didn’t save. Try again.'));
      return null;
    }
  };
}

function Members({ onInvite }: { onInvite: () => void }) {
  const q = useTeam();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const members = q.data?.members ?? [];
  const counts = useMemo(() => ({ all: members.length, Active: members.filter(m => m.status === 'Active').length, Invited: members.filter(m => m.status === 'Invited').length, Deactivated: members.filter(m => m.status === 'Deactivated').length }), [members]);
  const shown = filter === 'all' ? members : members.filter(m => m.status === filter);

  if (q.isPending) return <SectionSkeleton rows={6} />;
  if (q.isError || !q.data) return <SectionError error={q.error} onRetry={() => void q.refetch()} />;

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'Active', label: 'Active' },
    { key: 'Invited', label: 'Invited' },
    { key: 'Deactivated', label: 'Deactivated' },
  ];

  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-center gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            aria-pressed={filter === t.key}
            className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] transition-colors', filter === t.key ? 'border-border bg-accent font-medium text-foreground shadow-2xs' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
          >
            {t.label}
            <span className="tabular-nums text-muted-foreground">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card shadow-2xs">
        {shown.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={filter === 'Invited' ? 'No pending invites' : filter === 'Deactivated' ? 'Nobody is deactivated' : 'Nobody here yet'}
            description={filter === 'Invited' ? 'People you invite show here until they first sign in.' : filter === 'Deactivated' ? 'People whose access you remove show here, and can be reactivated.' : 'Invite your team to start working together.'}
            action={filter !== 'Deactivated' ? <button type="button" onClick={onInvite} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-xs hover:bg-accent">Invite a teammate</button> : <button type="button" onClick={() => setFilter('all')} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-xs hover:bg-accent">Show everyone</button>}
            className="py-12"
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="md:min-w-[760px]">
              <div className="grid h-9 grid-cols-[minmax(0,1fr)_132px_28px] md:grid-cols-[minmax(0,1fr)_minmax(0,150px)_164px_84px_88px_32px] items-center gap-3 border-b bg-subtle/60 px-4 text-sm text-muted-foreground">
                <span>Name</span>
                <span className="hidden md:block">Title</span>
                <span>Role</span>
                <span className="hidden md:block">Status</span>
                <span className="hidden md:block">Last seen</span>
                <span className="sr-only">Actions</span>
              </div>
              {shown.map(m => (
                <MemberRow key={m.id} member={m} isMe={m.id === q.data.meId} onEdit={() => setEditing(m)} />
              ))}
            </div>
          </div>
        )}
      </div>
      <EditMemberDialog member={editing} onOpenChange={o => !o && setEditing(null)} />
    </section>
  );
}

function MemberRow({ member: m, isMe, onEdit }: { member: TeamMember; isMe: boolean; onEdit: () => void }) {
  const app = useAppActions();
  const ws = useWorkspace();
  const act = useMemberActions();
  const [rolePicker, setRolePicker] = useState(false);
  const first = m.name.split(/\s+/)[0] || m.email;
  const deactivated = m.status === 'Deactivated';

  const changeRole = async (role: Role) => {
    if (role === m.role) return;
    if (isMe && m.role === 'Admin') {
      const ok = await app.confirm({ title: 'Change your own role?', description: `You’ll have the ${role} role and lose access to Settings and Team straight away.`, confirmLabel: 'Change my role', destructive: true });
      if (!ok) return;
    }
    const res = await act(m, { action: 'role', id: m.id, role }, { role }, `${isMe ? 'You now have' : `${m.name} now has`} the ${role} role`);
    if (res && isMe) window.setTimeout(() => window.location.reload(), 600);
  };

  const deactivate = async () => {
    const work = [m.openWorkOrders ? plural(m.openWorkOrders, 'open work order') : '', m.openTasks ? plural(m.openTasks, 'open task') : ''].filter(Boolean).join(' and ');
    const invited = m.status === 'Invited';
    const ok = await app.confirm({
      title: invited ? `Revoke ${first}’s invite?` : `Deactivate ${m.name}?`,
      description: invited
        ? `${m.email} won’t be able to sign in. You can reactivate the invite later.`
        : `${first} won’t be able to sign in.${work ? ` Their ${work} ${m.openWorkOrders + m.openTasks === 1 ? 'stays assigned to them — reassign it' : 'stay assigned to them — reassign them'} from ${m.openWorkOrders && m.openTasks ? 'Work orders and Tasks' : m.openWorkOrders ? 'Work orders' : 'Tasks'}.` : ''} You can reactivate them any time.`,
      confirmLabel: invited ? 'Revoke invite' : 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    await act(m, { action: 'deactivate', id: m.id }, { status: 'Deactivated' }, invited ? `Revoked ${first}’s invite` : `${m.name} can no longer sign in`);
  };

  const reactivate = () => act(m, { action: 'reactivate', id: m.id }, { status: m.lastSeenAt ? 'Active' : 'Invited' }, `${m.name} is back on the team`);
  const resend = async () => {
    const res = await act(m, { action: 'resend', id: m.id }, { invitedAt: new Date().toISOString() });
    if (!res) return;
    if (res.delivery === 'Sent') toast.success(`Invite resent to ${m.email}`);
    else toast.warning('The invite email didn’t send', { description: 'Send them the sign-in link yourself.', action: { label: 'Copy link', onClick: () => void copyText(appUrl('/home'), 'Sign-in link copied') } });
  };

  const roleOptions = ROLES.map((r, i) => ({ value: r, label: r, shortcut: String(i + 1) }));
  const lastSeen = m.status === 'Invited' ? (m.invitedAt ? `Invited ${timeAgo(m.invitedAt)}` : 'Invited') : m.lastSeenAt ? timeAgo(m.lastSeenAt) : 'Never';

  return (
    <div data-member={m.email} className={cn('grid min-h-[52px] grid-cols-[minmax(0,1fr)_132px_28px] md:grid-cols-[minmax(0,1fr)_minmax(0,150px)_164px_84px_88px_32px] items-center gap-3 border-b px-4 py-2 last:border-b-0', deactivated && 'bg-subtle/40')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={m.name} src={m.avatarUrl} color={m.color} size={28} className={cn(deactivated && 'opacity-50 grayscale')} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate text-[14px] font-medium', deactivated && 'text-muted-foreground')}>{m.name}</span>
            {isMe && <span className="shrink-0 rounded bg-muted px-1 text-[11.5px] font-medium text-muted-foreground">You</span>}
          </div>
          <div className="truncate text-sm text-muted-foreground">{m.email}{m.status !== 'Active' && <span className="md:hidden"> · {m.status}</span>}</div>
        </div>
      </div>
      <span className={cn('hidden truncate text-[14px] md:block', m.title ? 'text-foreground/90' : 'text-muted-foreground/60')} title={m.title || undefined}>{m.title || '—'}</span>
      <div className="min-w-0">
        {deactivated ? (
          <span className="px-1.5 text-[14px] text-muted-foreground">{m.role}</span>
        ) : (
          <OptionPicker
            options={roleOptions}
            value={m.role}
            onChange={v => void changeRole(v as Role)}
            open={rolePicker}
            onOpenChange={setRolePicker}
            placeholder="Change role…"
            width={220}
            trigger={
              <button type="button" aria-label={`Role for ${m.name}`} className="ghost-chip h-8 w-full justify-between px-1.5 text-[14px]">
                <span className="truncate">{m.role}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            }
          />
        )}
      </div>
      <div className="hidden md:block">
        <Pill tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{m.status}</Pill>
      </div>
      <Tip label={m.status === 'Invited' ? (m.invitedAt ? `Invited ${dateTime(m.invitedAt)}` : 'Hasn’t signed in yet') : m.lastSeenAt ? dateTime(m.lastSeenAt) : 'Hasn’t signed in yet'}>
        <span className="hidden truncate text-sm text-muted-foreground md:block">{lastSeen}</span>
      </Tip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Actions for ${m.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem className="text-[14px]" onSelect={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit name and title</DropdownMenuItem>
          {!deactivated && <DropdownMenuItem className="text-[14px]" onSelect={() => window.setTimeout(() => setRolePicker(true), 0)}><Users className="h-3.5 w-3.5" /> Change role</DropdownMenuItem>}
          {m.status === 'Invited' && <DropdownMenuItem className="text-[14px]" onSelect={() => void resend()}><Mail className="h-3.5 w-3.5" /> Resend invite</DropdownMenuItem>}
          {m.status === 'Invited' && <DropdownMenuItem className="text-[14px]" onSelect={() => void copyText(ws.settings.staffAppUrl ? `${ws.settings.staffAppUrl}/#/home` : appUrl('/home'), 'Sign-in link copied')}><Link2 className="h-3.5 w-3.5" /> Copy sign-in link</DropdownMenuItem>}
          {!isMe && <DropdownMenuSeparator />}
          {!isMe && !deactivated && (
            <DropdownMenuItem className="text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void deactivate()}>
              <UserMinus className="h-3.5 w-3.5" /> {m.status === 'Invited' ? 'Revoke invite' : 'Deactivate'}
            </DropdownMenuItem>
          )}
          {!isMe && deactivated && <DropdownMenuItem className="text-[14px]" onSelect={() => void reactivate()}><UserCheck className="h-3.5 w-3.5" /> Reactivate</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function EditMemberDialog({ member, onOpenChange }: { member: TeamMember | null; onOpenChange: (open: boolean) => void }) {
  const act = useMemberActions();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (member && member.id !== lastId) {
    setLastId(member.id);
    setName(member.name);
    setTitle(member.title);
    setError(null);
  }
  const submit = async () => {
    if (!member) return;
    if (!name.trim()) return setError('Enter a name.');
    setPending(true);
    const res = await act(member, { action: 'details', id: member.id, name: name.trim(), title: title.trim() }, { name: name.trim(), title: title.trim() }, 'Saved');
    setPending(false);
    if (res) {
      setLastId(null);
      onOpenChange(false);
    }
  };
  return (
    <FormDialog open={Boolean(member)} onOpenChange={o => { if (!o) setLastId(null); onOpenChange(o); }} title={`Edit ${member?.name ?? 'teammate'}`} size="sm" onSubmit={submit} pending={pending}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="member-name" error={error}>
          <TextInput id="member-name" value={name} invalid={Boolean(error)} onChange={e => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Title" optional htmlFor="member-title">
          <TextInput id="member-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="Property Manager" />
        </Field>
      </div>
    </FormDialog>
  );
}
