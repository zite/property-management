import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowUpRight, Building2, Globe, Link2, Lock, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, Send, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveOwner, sendOwnerMessage, type SaveOwnerInputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Switch } from '@project/components/ui/switch';
import { DISTRIBUTION_METHODS } from '@project/shared/constants';
import { DetailLayout, InlineTabs, RailRow, RailSection } from '../components/detail/DetailLayout';
import { DocumentsPanel } from '../components/detail/DocumentsPanel';
import { Composer, Timeline, type ComposerMode } from '../components/detail/Timeline';
import { NumberInput } from '../components/form/fields';
import { ChoicePicker } from '../components/pickers/pickers';
import { Avatar, MemberAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, Tip } from '../components/primitives/bits';
import { Money } from '../components/primitives/data';
import { Pill } from '../components/primitives/glyphs';
import { OccupancyBar, PropertyThumb } from '../components/portfolio/bits';
import { afterPortfolioWrite, occupancyOf, pk, propertyAddress, useOwner, type OwnerDetail } from '../components/portfolio/data';
import { OwnerStatement } from '../components/portfolio/OwnerStatement';
import { OwnerTransactions } from '../components/portfolio/OwnerTransactions';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl, fullDate, plural, telHref, timeAgo } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { invalidate, retryUnlessNotFound } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';

/**
 * An owner: their properties, cash-basis statements, owner money, shared
 * documents, the conversation with them, and history. The rail edits how
 * they're paid and their portal access in place; "Invite" emails the owner
 * portal link. Tabs are `?tab=` so each is a link.
 */

type Tab = 'properties' | 'statement' | 'transactions' | 'documents' | 'messages' | 'activity';
const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

export function OwnerPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const { data, isPending, isError, error, refetch } = useOwner(id);
  const known = ws.ownerById.get(id);
  const name = data?.owner.name ?? known?.name;
  useDocumentTitle(name ?? 'Owner');
  const money = ws.can('accounting.view');

  const tabs = useMemo(
    () => [
      { value: 'properties' as Tab, label: 'Properties', count: data?.properties.length ?? null },
      ...(money ? [{ value: 'statement' as Tab, label: 'Statement' }, { value: 'transactions' as Tab, label: 'Transactions' }] : []),
      { value: 'documents' as Tab, label: 'Documents', count: data?.documentCount ?? null },
      { value: 'messages' as Tab, label: 'Messages', count: data?.messages.length ?? null },
      { value: 'activity' as Tab, label: 'Activity' },
    ],
    [data, money],
  );
  const tab: Tab = tabs.some(t => t.value === params.get('tab')) ? (params.get('tab') as Tab) : 'properties';
  const go = (t: Tab) => setParams(t === 'properties' ? {} : { tab: t }, { replace: true });

  useHotkeys({ e: () => data && app.openCreate('owner', { ownerId: id }) }, { enabled: Boolean(data) });

  const archive = async () => {
    if (!data) return;
    const o = data.owner;
    const restoring = o.status === 'Archived';
    const live = data.properties.filter(p => p.status !== 'Archived');
    if (!restoring && live.length) {
      await app.confirm({ title: `${o.name} can’t be archived yet`, description: `They still own ${live.slice(0, 3).map(p => p.name).join(', ')}${live.length > 3 ? ` and ${live.length - 3} more` : ''}. Change the owner of ${live.length === 1 ? 'that property' : 'those properties'} or archive ${live.length === 1 ? 'it' : 'them'} first.`, confirmLabel: 'OK' });
      return;
    }
    if (!restoring && !(await app.confirm({ title: `Archive ${o.name}?`, description: 'They leave owner lists and pickers and lose portal access. Their statements, transactions and messages are kept.', confirmLabel: 'Archive owner', destructive: true }))) return;
    try {
      await saveOwner({ action: restoring ? 'unarchive' : 'archive', id });
      afterPortfolioWrite(qc);
      toast.success(restoring ? `Restored ${o.name}` : `Archived ${o.name}`);
    } catch (e) {
      toast.error(errorMessage(e, restoring ? 'Couldn’t restore the owner' : 'Couldn’t archive the owner'));
    }
  };

  const header = (
    <PageHeader
      breadcrumb={{ to: '/owners', label: 'Owners' }}
      icon={known ? <Avatar name={known.name} color={known.color} size={16} /> : <UserRound />}
      title={name ?? 'Owner'}
      actions={
        data && (
          <>
            <Tip label="Edit owner" keys={['E']}>
              <button type="button" onClick={() => app.openCreate('owner', { ownerId: id })} className="ghost-chip hidden h-8 gap-1.5 sm:inline-flex"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            </Tip>
            {data.canMessage && data.owner.email && (
              <button type="button" onClick={() => go('messages')} className="ghost-chip hidden h-8 gap-1.5 md:inline-flex"><Mail className="h-3.5 w-3.5" /> Message</button>
            )}
            {money && (ws.can('banking.manage') || ws.can('payables.manage')) && (
              <Link to="/accounting/owners" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Record distribution</span>
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconButton aria-label="More actions"><MoreHorizontal /></IconButton></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="h-9 gap-2 text-[14px] sm:hidden" onSelect={() => app.openCreate('owner', { ownerId: id })}><Pencil className="h-3.5 w-3.5" /> Edit owner</DropdownMenuItem>
                {ws.can('portfolio.manage') && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('property', { ownerId: id })}><Plus className="h-3.5 w-3.5" /> New property for this owner</DropdownMenuItem>}
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/owners/${id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</DropdownMenuItem>
                {data.owner.email && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(data.owner.email, 'Email copied')}><Mail className="h-3.5 w-3.5" /> Copy email</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className={cn('h-9 gap-2 text-[14px]', data.owner.status !== 'Archived' && 'text-tone-danger focus:text-tone-danger')} onSelect={() => void archive()}>
                  {data.owner.status === 'Archived' ? <><ArchiveRestore className="h-3.5 w-3.5" /> Restore owner</> : <><Archive className="h-3.5 w-3.5" /> Archive owner…</>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header} wide rail={<div className="space-y-3 p-4">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-6" />)}</div>}>
        <div className="skeleton h-8 w-64" />
        <div className="skeleton mt-5 h-9 w-full" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{[0, 1].map(i => <div key={i} className="skeleton h-40 rounded-lg" />)}</div>
      </DetailLayout>
    );
  }
  if (isError || !data) {
    const missing = !retryUnlessNotFound(0, error);
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<UserRound />} title={missing ? 'Owner not found' : 'This owner didn’t load'} description={errorMessage(error, missing ? 'They may have been deleted, or the link is wrong.' : 'Something went wrong.')} action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/owners')}>Back to owners</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      </DetailLayout>
    );
  }

  const o = data.owner;
  return (
    <DetailLayout header={header} wide rail={<OwnerRail detail={data} />}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Avatar name={o.name} color={o.color} size={32} />
        <h1 className="min-w-0 text-[22px] font-semibold leading-8 tracking-tight">{o.name}</h1>
        <Pill>{o.ownerType}</Pill>
        {o.status === 'Archived' && <Pill tone="warning">Archived</Pill>}
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">
        {plural(data.properties.filter(p => p.status !== 'Archived').length, 'property', 'properties')}
        {data.totals ? <> · <Money value={data.totals.distributionsYtd} cents={false} /> distributed this year{data.totals.lastDistribution ? ` · last paid ${fullDate(data.totals.lastDistribution.date)}` : ''}</> : null}
      </p>

      <InlineTabs value={tab} onChange={go} tabs={tabs} className="mb-5 mt-5" />

      {tab === 'properties' && <OwnerProperties detail={data} />}
      {tab === 'statement' && money && <OwnerStatement ownerId={id} />}
      {tab === 'transactions' && money && <OwnerTransactions ownerId={id} ownerName={o.name} />}
      {tab === 'documents' && (
        <>
          <p className="mb-3 text-[14px] text-muted-foreground">Management agreements, tax forms and anything else for {o.name}. Share a document to show it in their owner portal.</p>
          <DocumentsPanel scope="ownerId" id={id} links={{ ownerId: id }} showSharing={{ owner: true }} defaultCategory="Other" />
        </>
      )}
      {tab === 'messages' && <OwnerMessages detail={data} />}
      {tab === 'activity' && <Timeline activity={data.activity} newestFirst emptyText={`Nothing has happened with ${o.name} yet.`} />}
    </DetailLayout>
  );
}

function OwnerProperties({ detail }: { detail: OwnerDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const props = [...detail.properties].sort((a, b) => Number(a.status === 'Archived') - Number(b.status === 'Archived') || a.name.localeCompare(b.name));
  if (!props.length) {
    return (
      <EmptyState
        className="py-14"
        icon={<Building2 />}
        title={`${detail.owner.name} doesn’t own any properties yet`}
        description="Set them as the owner on a property, or add a new one."
        action={ws.can('portfolio.manage') ? <button type="button" onClick={() => app.openCreate('property', { ownerId: detail.owner.id })} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New property</button> : undefined}
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.map(row => {
        const p = ws.propertyById.get(row.id);
        const counts = occupancyOf(ws.unitsByProperty.get(row.id) ?? []);
        const manager = p?.managerId ? ws.memberById.get(p.managerId) : undefined;
        return (
          <Link key={row.id} to={`/properties/${row.id}`} className={cn('group overflow-hidden rounded-lg border bg-card shadow-2xs transition-colors hover:border-foreground/20', row.status === 'Archived' && 'opacity-70')}>
            <div className="flex items-start gap-3 p-3.5">
              <PropertyThumb photoUrl={p?.photoUrl} color={p?.color} code={p?.code} name={row.name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium group-hover:underline">{row.name}</span>
                  {row.status !== 'Active' && <Pill>{row.status}</Pill>}
                </div>
                <p className="truncate text-sm text-muted-foreground">{p ? propertyAddress(p) || p.propertyType : ''}</p>
              </div>
              {manager && <Tip label={`Managed by ${manager.name}`}><span><MemberAvatar member={manager} size={20} /></span></Tip>}
            </div>
            <div className="border-t px-3.5 py-2.5">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{plural(counts.total, 'unit')} · {counts.vacant ? `${counts.vacant} vacant` : 'fully leased'}</span>
              </div>
              <OccupancyBar counts={counts} className="mt-1.5 w-full" />
            </div>
            {row.cash != null && (
              <dl className="grid grid-cols-2 border-t text-[14px]">
                <div className="px-3.5 py-2"><dt className="text-sm text-muted-foreground">Cash</dt><dd className="mt-0.5"><Money value={row.cash} /></dd></div>
                <div className="border-l px-3.5 py-2"><dt className="text-sm text-muted-foreground">Deposits held</dt><dd className="mt-0.5"><Money value={row.depositsHeld} /></dd></div>
              </dl>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function OwnerMessages({ detail }: { detail: OwnerDetail }) {
  const qc = useQueryClient();
  const o = detail.owner;
  const first = (o.contactName || o.name).split(/\s+/)[0];
  const modes: ComposerMode[] = [
    ...(detail.canMessage && o.email && o.status !== 'Archived' ? [{ value: 'message', label: `Email ${first}`, icon: <Mail />, placeholder: `Write to ${o.contactName || o.name}…`, hint: `Emailed to ${o.email}${o.portalEnabled ? ' and shown in their portal' : ''}.` }] : []),
    { value: 'note', label: 'Internal note', icon: <Lock />, placeholder: 'Add a note for your team…' },
  ];
  const send = async ({ mode, body }: { mode: string; body: string }) => {
    try {
      const res = await sendOwnerMessage(mode === 'note' ? { mode: 'note', ownerId: o.id, body } : { mode: 'message', ownerId: o.id, body });
      await qc.invalidateQueries({ queryKey: pk.owner(o.id) });
      invalidate(qc, 'messages', 'inbox');
      if (mode !== 'note') {
        if (res.delivery === 'Failed') toast.error(`The email to ${o.email} didn’t go through. It’s saved in the conversation.`);
        else toast.success(`Message sent to ${first}`);
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send'));
      throw e;
    }
  };
  return (
    <div>
      {detail.messages.length === 0 ? (
        <p className="mb-4 rounded-lg border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">No messages with {o.name} yet.{!o.email && ' Add an email address to write to them.'}</p>
      ) : (
        <Timeline activity={[]} messages={detail.messages} />
      )}
      <Composer className="mt-4" modes={modes} onSend={send} />
    </div>
  );
}

function OwnerRail({ detail }: { detail: OwnerDetail }) {
  const app = useAppActions();
  const qc = useQueryClient();
  const o = detail.owner;
  const [portal, setPortal] = useState<boolean | null>(null);
  const [inviting, setInviting] = useState(false);
  const [feeOpen, setFeeOpen] = useState(false);
  const [fee, setFee] = useState<number | null>(o.managementFeePercent);
  const portalOn = portal ?? o.portalEnabled;
  const archived = o.status === 'Archived';

  const patch = async (fields: Extract<SaveOwnerInputType, { action: 'update' }>['fields'], success: string, rollback?: () => void) => {
    qc.setQueryData<OwnerDetail>(pk.owner(o.id), old => (old ? { ...old, owner: { ...old.owner, ...fields } } : old));
    try {
      await saveOwner({ action: 'update', id: o.id, fields });
      afterPortfolioWrite(qc);
      toast.success(success);
    } catch (e) {
      rollback?.();
      void qc.invalidateQueries({ queryKey: pk.owner(o.id) });
      toast.error(errorMessage(e, 'Couldn’t save the owner'));
    }
  };

  const invite = async () => {
    if (!o.email) return;
    const ok = await app.confirm({
      title: `Invite ${o.contactName || o.name} to the owner portal?`,
      description: `We’ll email ${o.email} a link to sign in${o.portalEnabled ? '' : ' and turn on their portal access'}. They’ll see statements, distributions, approvals and shared documents for their properties.`,
      confirmLabel: 'Send invite',
    });
    if (!ok) return;
    setInviting(true);
    try {
      const res = await sendOwnerMessage({ mode: 'invite', ownerId: o.id });
      setPortal(null);
      afterPortfolioWrite(qc);
      if (res.delivery === 'Failed') toast.error(`The invite to ${o.email} didn’t go through. Check the address and try again.`);
      else toast.success(`Invite sent to ${o.email}`, res.portalLinked ? undefined : { description: 'The portal’s address isn’t known yet, so the email has no link. Opening the portal app once fixes that.' });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the invite'));
    } finally {
      setInviting(false);
    }
  };

  const lastInvite = detail.activity.filter(a => a.action === 'portal_invited').slice(-1)[0];

  return (
    <>
      <RailSection title="Contact">
        {o.contactName && o.contactName !== o.name && <RailRow label="Contact"><span className="flex h-8 min-w-0 items-center gap-1.5 px-1.5 text-[14px]"><UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{o.contactName}</span></span></RailRow>}
        <RailRow label="Email">{o.email ? <a href={`mailto:${o.email}`} className={chip}><Mail className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{o.email}</span></a> : <button type="button" onClick={() => app.openCreate('owner', { ownerId: o.id })} className={cn(chip, 'text-muted-foreground')}>Add email</button>}</RailRow>
        <RailRow label="Phone">{o.phone ? <a href={telHref(o.phone)} className={chip}><Phone className="h-3.5 w-3.5 text-muted-foreground" />{o.phone}</a> : <span className="px-1.5 text-[14px] text-muted-foreground">—</span>}</RailRow>
        {o.mailingAddress && (
          <RailRow label="Mailing" className="items-start">
            <span className="flex gap-1.5 px-1.5 py-1.5 text-[14px] leading-5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="whitespace-pre-line">{o.mailingAddress}</span></span>
          </RailRow>
        )}
      </RailSection>

      <RailSection title="Payments">
        <RailRow label="Pay by">
          <ChoicePicker
            options={DISTRIBUTION_METHODS}
            value={o.distributionMethod as (typeof DISTRIBUTION_METHODS)[number]}
            onChange={m => m !== o.distributionMethod && void patch({ distributionMethod: m }, m === 'Hold' ? `Holding ${o.name}’s distributions` : `${o.name} is paid by ${m}`)}
            align="end"
            disabled={archived}
            trigger={<button type="button" className={chip}>{o.distributionMethod === 'Hold' ? 'Hold funds' : o.distributionMethod}</button>}
          />
        </RailRow>
        <RailRow label="Mgmt fee">
          <Popover open={feeOpen} onOpenChange={v => { setFeeOpen(v); if (v) setFee(o.managementFeePercent); }}>
            <PopoverTrigger asChild>
              <button type="button" className={chip} disabled={archived}>
                {o.managementFeePercent != null ? `${o.managementFeePercent}%` : <span>{detail.defaultFeePercent}% <span className="text-muted-foreground">default</span></span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3 shadow-lg" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setFeeOpen(false); if (fee !== o.managementFeePercent) void patch({ managementFeePercent: fee }, fee == null ? 'Using the default fee' : `Management fee set to ${fee}%`); } }}>
              <label className="text-sm font-medium text-muted-foreground">Management fee for {o.name}</label>
              <NumberInput value={fee} onChange={setFee} min={0} max={100} step={0.25} suffix="%" placeholder={`${detail.defaultFeePercent} (default)`} className="mt-1.5" />
              <p className="mt-1.5 text-sm text-muted-foreground">Leave blank for the company default. A property can override it.</p>
              <div className="mt-2 flex justify-end gap-1">
                <button type="button" onClick={() => setFeeOpen(false)} className="h-8 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
                <button type="button" disabled={fee != null && (fee < 0 || fee > 100)} onClick={() => { setFeeOpen(false); if (fee !== o.managementFeePercent) void patch({ managementFeePercent: fee }, fee == null ? 'Using the default fee' : `Management fee set to ${fee}%`); }} className="h-8 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button>
              </div>
            </PopoverContent>
          </Popover>
        </RailRow>
        {o.taxIdLast4 && <RailRow label="Tax ID"><span className="px-1.5 font-mono text-[13.5px] text-muted-foreground">•••–••–{o.taxIdLast4}</span></RailRow>}
        {detail.totals && (
          <>
            <RailRow label="Cash held"><span className="px-1.5 text-[14px]"><Money value={detail.totals.cash} /></span></RailRow>
            <RailRow label="Fees this year"><span className="px-1.5 text-[14px]"><Money value={detail.totals.feesYtd} /></span></RailRow>
            {detail.totals.contributionsYtd > 0 && <RailRow label="Contributed"><span className="px-1.5 text-[14px]"><Money value={detail.totals.contributionsYtd} /></span></RailRow>}
          </>
        )}
      </RailSection>

      <RailSection title="Owner portal">
        <label className={cn('flex min-h-9 items-center justify-between gap-2 px-1.5 text-[14px]', !o.email || archived ? 'cursor-not-allowed opacity-70' : 'cursor-pointer')}>
          <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-muted-foreground" /> {portalOn ? 'Can sign in' : 'No access'}</span>
          <Switch
            checked={portalOn}
            disabled={!o.email || archived}
            aria-label="Owner portal access"
            onCheckedChange={v => {
              setPortal(v);
              void patch({ portalEnabled: v }, v ? `${o.name} can sign in to the owner portal` : `Portal access turned off for ${o.name}`, () => setPortal(null));
            }}
          />
        </label>
        <p className="px-1.5 text-sm text-muted-foreground">
          {!o.email ? 'Add an email address to give them access.' : portalOn ? `${o.email} signs in with a one-time code — no password.` : 'Turn on to let them see statements and approve work.'}
        </p>
        {detail.canMessage && o.email && !archived && (
          <button type="button" onClick={() => void invite()} disabled={inviting} className="ghost-chip mt-1.5 h-8 gap-1.5 text-[14px] disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> {inviting ? 'Sending…' : lastInvite ? 'Resend invite' : 'Invite to portal'}
          </button>
        )}
        {lastInvite && <p className="px-1.5 pt-1 text-sm text-muted-foreground">Invited {timeAgo(lastInvite.occurredAt)}</p>}
        {detail.portalUrl && portalOn && (
          <a href={detail.portalUrl} target="_blank" rel="noreferrer" className={cn(chip, 'text-muted-foreground')}><ArrowUpRight className="h-3.5 w-3.5" /> Open the owner portal</a>
        )}
      </RailSection>

      {o.notes && (
        <RailSection title="Notes">
          <p className="whitespace-pre-wrap px-1.5 text-[14px] leading-relaxed text-foreground/85">{o.notes}</p>
        </RailSection>
      )}
      <RailSection>
        <RailRow label="Colour"><span className="flex items-center gap-1.5 px-1.5"><span className="h-3 w-3 rounded-[3px]" style={{ background: o.color }} /></span></RailRow>
        {detail.lastMessageAt && <RailRow label="Last message"><span className="px-1.5 text-[14px]">{timeAgo(detail.lastMessageAt)}</span></RailRow>}
      </RailSection>
    </>
  );
}
