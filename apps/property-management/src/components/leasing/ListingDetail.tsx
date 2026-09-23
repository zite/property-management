import { CalendarClock, Copy, ExternalLink, Eye, FileText, Inbox, Loader2, Plus, Sparkles, TriangleAlert, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { aiListingDescription } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { PET_POLICIES } from '@project/shared/constants';
import { applicationRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { bedsBaths, dateTime, fullDate, shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { Timeline } from '../detail/Timeline';
import { DateInput, Field, FieldRow, MoneyInput, TextInput } from '../form/fields';
import { FieldButton, MemberPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { ApplicationStatusGlyph, PropertySwatch } from '../primitives/glyphs';
import { ApplicationStatusPill, IncomeRatio, InquiryStatusGlyph, ListingStatusPill, ScreeningMeter } from './bits';
import { useListingActions, type ListingDetail as Detail, type ListingPatch } from './data';
import { ListingPhotos } from './ListingPhotos';
import { AMENITY_SUGGESTIONS, LEASE_TERM_SUGGESTIONS, slugify } from './rules';

/** Text that edits in place and saves on blur (⌘↵ also saves). */
function InlineText({ value, onSave, placeholder, multiline, className, minRows = 1 }: { value: string; onSave: (v: string) => void; placeholder: string; multiline?: boolean; className?: string; minRows?: number }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const commit = () => {
    const next = multiline ? text.replace(/\s+$/, '') : text.trim();
    if (next === value) return;
    if (!multiline && !next) return setText(value);
    onSave(next);
  };
  return (
    <textarea
      ref={ref}
      value={text}
      rows={minRows}
      onChange={e => setText(multiline ? e.target.value : e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      placeholder={placeholder}
      className={cn('block w-full resize-none overflow-hidden rounded-md bg-transparent outline-none placeholder:text-muted-foreground/70 hover:bg-accent/30 focus:bg-accent/30', className)}
    />
  );
}

/** A field that holds its own draft and saves when focus leaves it. */
function BlurSave({ children, onCommit }: { children: ReactNode; onCommit: () => void }) {
  return (
    <div
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCommit();
      }}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).blur()}
    >
      {children}
    </div>
  );
}

function Amenities({ values, suggestions, onChange }: { values: string[]; suggestions: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (v: string) => {
    const t = v.trim().slice(0, 60);
    if (!t || values.some(x => x.toLowerCase() === t.toLowerCase())) return setDraft('');
    onChange([...values, t]);
    setDraft('');
  };
  const rest = suggestions.filter(s => !values.some(v => v.toLowerCase() === s.toLowerCase())).slice(0, 10);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map(v => (
          <span key={v} className="chip max-w-[240px] bg-background pr-1">
            <span className="truncate">{v}</span>
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter(x => x !== v))} className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            }
            if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={values.length ? 'Add another…' : 'Add a feature, e.g. In-unit washer & dryer'}
          maxLength={60}
          className="h-6 min-w-[180px] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      {rest.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm text-muted-foreground">Suggestions</span>
          {rest.map(s => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-sm text-muted-foreground hover:border-solid hover:bg-accent hover:text-foreground"><Plus className="h-3 w-3" />{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What a listing still needs before it can go live, in the server's words. */
export function publishGaps(l: Detail['listing']) {
  const gaps: string[] = [];
  if (l.title.trim().length < 3) gaps.push('a title');
  if (!(l.rent && l.rent > 0)) gaps.push('the rent');
  if (!l.unitId) gaps.push('a unit');
  if (l.description.trim().length < 40) gaps.push('a description of a few sentences');
  return gaps;
}

export function ListingMain({ detail }: { detail: Detail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { update } = useListingActions();
  const l = detail.listing;
  const save = (patch: ListingPatch, toastText?: string) => void update(l.id, patch, { toast: toastText }).catch(() => undefined);
  const [rent, setRent] = useState(l.rent);
  const [deposit, setDeposit] = useState(l.deposit);
  const [fee, setFee] = useState(l.applicationFee);
  const [slug, setSlug] = useState(l.slug);
  const [drafting, setDrafting] = useState(false);
  useEffect(() => { setRent(l.rent); setDeposit(l.deposit); setFee(l.applicationFee); setSlug(l.slug); }, [l.id, l.rent, l.deposit, l.applicationFee, l.slug]);
  const gaps = publishGaps(l);

  const draftDescription = async () => {
    if (l.description.trim().length > 40 && !(await app.confirm({ title: 'Replace the description?', description: ws.integrations.ai ? 'Claude writes a new draft from the unit, building and features. You can undo right after.' : 'A new draft is built from the unit, building and features. You can undo right after.', confirmLabel: 'Write a new draft' }))) return;
    setDrafting(true);
    const before = l.description;
    try {
      const res = await aiListingDescription({ listingId: l.id, amenities: l.amenities });
      await update(l.id, { description: res.description });
      toast.success(res.ai ? 'Drafted with AI — read it over before publishing' : 'Drafted from the unit’s details', { action: { label: 'Undo', onClick: () => save({ description: before }, 'Description restored') } });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t draft a description'));
    } finally {
      setDrafting(false);
    }
  };

  const suggestions = useMemo(() => [...new Set([...detail.unitFeatures, ...(detail.building?.amenities ?? []), ...AMENITY_SUGGESTIONS])], [detail.unitFeatures, detail.building]);

  return (
    <div>
      <InlineText value={l.title} onSave={title => save({ title })} placeholder="Listing title" className="-mx-1.5 px-1.5 py-1 text-[22px] font-semibold leading-8 tracking-tight" />
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[14px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} />{ws.unitLabel(l.unitId, l.propertyId) || 'No unit'}</span>
        {l.beds != null && <span>· {bedsBaths(l.beds, l.baths ?? 0, l.squareFeet)}</span>}
        {detail.building?.address && <span>· {detail.building.address}</span>}
      </p>

      {l.status === 'Draft' && (
        <div className={cn('mt-5 flex items-start gap-3 rounded-lg border px-4 py-3', gaps.length ? 'border-tone-warning/30 bg-tone-warning/[0.06]' : 'bg-subtle/60')}>
          {gaps.length ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 text-[14px]">
            <p className="font-medium">{gaps.length ? `Add ${gaps.join(', ').replace(/, ([^,]*)$/, ' and $1')} to publish` : 'Ready to publish'}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{l.photos.length ? `${l.photos.length} ${l.photos.length === 1 ? 'photo' : 'photos'}.` : 'Listings with photos get far more leads.'} Drafts aren’t visible on the portal.</p>
          </div>
        </div>
      )}
      {detail.siblings.some(s => s.status === 'Published') && l.status !== 'Published' && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border px-4 py-2.5 text-[14px]">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" />
          <span>Another listing already advertises this unit: {detail.siblings.filter(s => s.status === 'Published').map(s => <Link key={s.id} to={`/listings/${s.id}`} className="font-medium hover:underline">{s.title}</Link>)}. Pause it before publishing this one.</span>
        </div>
      )}

      <SectionHeading count={l.photos.length || undefined} action={<span className="text-sm text-muted-foreground">The first photo is the cover</span>}>Photos</SectionHeading>
      <ListingPhotos photos={l.photos} onChange={photos => save({ photos })} disabled={l.status === 'Leased'} />

      <SectionHeading
        action={
          <button type="button" className="ghost-chip h-8 text-sm" disabled={drafting} onClick={() => void draftDescription()}>
            {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {ws.integrations.ai ? 'Write with AI' : 'Draft from unit details'}
          </button>
        }
      >
        Description
      </SectionHeading>
      <div className="rounded-lg border bg-card px-3 py-2 shadow-2xs">
        <InlineText value={l.description} onSave={description => save({ description }, 'Description saved')} placeholder="What makes this home worth seeing — layout, light, updates, the neighborhood. A few short paragraphs." multiline minRows={4} className="min-h-[96px] px-1 py-1 text-[15px] leading-relaxed hover:bg-transparent focus:bg-transparent" />
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">Describe the home, not who should live there — fair housing rules apply to listing copy.</p>

      <SectionHeading>Rent and terms</SectionHeading>
      <div className="space-y-3 rounded-lg border bg-card px-4 py-3.5 shadow-2xs">
        <FieldRow cols={3}>
          <Field label="Rent / month" hint={l.marketRent ? `Market rent ${ws.money(l.marketRent, { cents: false })}` : undefined}>
            <BlurSave onCommit={() => rent !== l.rent && save({ rent }, 'Rent updated')}><MoneyInput value={rent} onChange={setRent} /></BlurSave>
          </Field>
          <Field label="Deposit">
            <BlurSave onCommit={() => deposit !== l.deposit && save({ deposit }, 'Deposit updated')}><MoneyInput value={deposit} onChange={setDeposit} /></BlurSave>
          </Field>
          <Field label="Application fee" hint={l.applicationFee == null ? `Using your default, ${ws.money(ws.settings.applicationFee)}` : undefined}>
            <BlurSave onCommit={() => fee !== l.applicationFee && save({ applicationFee: fee }, 'Application fee updated')}><MoneyInput value={fee} onChange={setFee} placeholder={String(ws.settings.applicationFee.toFixed(2))} /></BlurSave>
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Available on">
            <DateInput value={l.availableOn} onChange={d => save({ availableOn: d })} />
          </Field>
          <Field label="Lease term">
            <TextInput list="ks-lease-terms" defaultValue={l.leaseTerm} key={l.leaseTerm} maxLength={60} placeholder="12 months" onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} onBlur={e => e.target.value.trim() !== l.leaseTerm && save({ leaseTerm: e.target.value.trim() }, 'Lease term updated')} />
            <datalist id="ks-lease-terms">{LEASE_TERM_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Pets">
            <OptionPicker
              options={PET_POLICIES.map((p, i) => ({ value: p, label: p, shortcut: String(i + 1) }))}
              value={l.petPolicy || null}
              onChange={v => v && save({ petPolicy: v as ListingPatch['petPolicy'] }, `Pet policy: ${v}`)}
              placeholder="Pet policy…"
              trigger={<FieldButton placeholder={detail.building?.petPolicy ? `Building: ${detail.building.petPolicy}` : 'Choose a pet policy'}>{l.petPolicy || null}</FieldButton>}
            />
          </Field>
        </FieldRow>
        <Field label="Link" hint={l.status === 'Published' ? 'Changing it breaks links people already have.' : 'Letters, numbers and dashes.'}>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[14px] text-muted-foreground">/homes/</span>
            <TextInput
              value={slug}
              maxLength={80}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              onBlur={() => {
                const next = slugify(slug) || l.slug;
                setSlug(next);
                if (next !== l.slug) save({ slug: next }, 'Link updated');
              }}
              onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="num"
            />
          </div>
        </Field>
      </div>

      <SectionHeading>Features</SectionHeading>
      <div className="rounded-lg border bg-card px-3.5 py-3 shadow-2xs">
        <Amenities values={l.amenities} suggestions={suggestions} onChange={amenities => save({ amenities })} />
      </div>

      <SectionHeading>Showing instructions</SectionHeading>
      <div className="rounded-lg border bg-card px-3 py-2 shadow-2xs">
        <InlineText value={l.showingInstructions} onSave={showingInstructions => save({ showingInstructions }, 'Showing instructions saved')} placeholder="How people can see the home — self-guided hours, lockbox, notice to current residents." multiline minRows={2} className="px-1 py-1 text-[14px] leading-relaxed hover:bg-transparent focus:bg-transparent" />
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">Shown on the public listing.</p>

      <SectionHeading count={detail.leads.length} action={<button type="button" className="ghost-chip h-8 text-sm" onClick={() => app.openCreate('inquiry', { listingId: l.id, unitId: l.unitId ?? undefined, propertyId: l.propertyId ?? undefined })}><Plus className="h-3.5 w-3.5" /> Log a lead</button>}>Leads</SectionHeading>
      {detail.leads.length ? (
        <div className="overflow-hidden rounded-lg border">
          {detail.leads.slice(0, 50).map(q => (
            <Link key={q.id} to={`/leasing/leads?lead=${q.id}`} className="flex h-9 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">
              <InquiryStatusGlyph status={q.status} />
              <span className="min-w-0 max-w-[40%] truncate font-medium">{q.name}</span>
              <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:inline">{q.message}</span>
              <span className="flex-1 sm:hidden" />
              {q.showingAt && <span className="hidden items-center gap-1 text-sm text-muted-foreground md:inline-flex"><CalendarClock className="h-3 w-3" />{shortDate(q.showingAt)}</span>}
              <span className="w-14 shrink-0 text-right text-sm text-muted-foreground">{timeAgo(q.receivedAt)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-5 text-center text-[14px] text-muted-foreground">No leads yet. Questions and showing requests from the public listing show up here.</p>
      )}

      <SectionHeading count={detail.applications.length}>Applications</SectionHeading>
      {detail.applications.length ? (
        <div className="overflow-hidden rounded-lg border">
          {detail.applications.map(a => (
            <Link key={a.id} to={`/applications/${a.number}`} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">
              <span className="w-[62px] shrink-0 text-sm tabular-nums text-muted-foreground">{applicationRef(a.number)}</span>
              <ApplicationStatusGlyph status={a.status} />
              <span className="min-w-0 flex-1 truncate font-medium">{a.applicantName}{a.coApplicantNames.length ? <span className="font-normal text-muted-foreground"> +{a.coApplicantNames.length}</span> : null}</span>
              <span className="hidden sm:inline-flex"><IncomeRatio income={a.householdIncome} rent={a.rent} /></span>
              <span className="hidden md:inline-flex"><ScreeningMeter done={a.screeningDone} flags={a.screeningFlags} total={a.screeningTotal} /></span>
              <ApplicationStatusPill status={a.status} />
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-5 text-center text-[14px] text-muted-foreground">{l.status === 'Published' ? 'No applications yet. Send the application link to your leads.' : 'Applications open once the listing is published.'}</p>
      )}

      <SectionHeading>History</SectionHeading>
      <Timeline activity={detail.activity} emptyText="No changes recorded yet." />
    </div>
  );
}

export function ListingRail({ detail }: { detail: Detail }) {
  const ws = useWorkspace();
  const { update } = useListingActions();
  const l = detail.listing;
  const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
  const contact = l.contactMemberId ? ws.memberById.get(l.contactMemberId) : undefined;
  const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';
  const diff = l.rent && l.marketRent ? l.rent - l.marketRent : 0;
  return (
    <>
      <RailSection>
        <RailRow label="Status"><span className="px-1.5"><ListingStatusPill status={l.status} /></span></RailRow>
        <RailRow label="Unit">{property ? <Link to={l.unitId ? `/units/${l.unitId}` : `/properties/${property.id}`} className={chip}><PropertySwatch color={property.color} /><span className="truncate">{ws.unitLabel(l.unitId, l.propertyId)}</span></Link> : <span className="px-1.5 text-muted-foreground">—</span>}</RailRow>
        <RailRow label="Rent">
          <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-[14px]">
            <Money value={l.rent} muted0 />
            {diff !== 0 && <span className={cn('truncate text-sm', diff > 0 ? 'text-muted-foreground' : 'text-tone-warning')}>{ws.money(Math.abs(diff), { cents: false })} {diff > 0 ? 'above' : 'below'} market</span>}
          </span>
        </RailRow>
        <RailRow label="Readiness"><span className={cn('px-1.5 text-[14px]', detail.readiness !== 'Ready' && 'text-tone-warning')}>{detail.readiness}</span></RailRow>
        <RailRow label="Contact">
          <MemberPicker value={l.contactMemberId} onChange={id => void update(l.id, { contactMemberId: id }, { toast: id ? `${ws.memberName(id)} is the leasing contact` : 'Leasing contact removed' }).catch(() => undefined)} noneLabel="Whole leasing team" align="end" filter={m => ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)} trigger={<button type="button" className={chip}>{contact ? <><MemberAvatar member={contact} size={18} /><span className="truncate">{contact.name}</span></> : <><UnassignedAvatar size={18} /><span className="text-muted-foreground">Whole leasing team</span></>}</button>} />
        </RailRow>
      </RailSection>

      <RailSection title="Performance">
        <RailRow label="On market"><span className="px-1.5 text-[14px]">{l.daysOnMarket != null ? `${l.daysOnMarket} ${l.daysOnMarket === 1 ? 'day' : 'days'}` : l.status === 'Draft' ? 'Not published' : '—'}</span></RailRow>
        {l.publishedAt && <RailRow label="Published"><Tip label={dateTime(l.publishedAt)}><span className="px-1.5 text-[14px]">{fullDate(l.publishedAt)}</span></Tip></RailRow>}
        <RailRow label="Views"><span className="flex items-center gap-1.5 px-1.5 text-[14px] tabular-nums"><Eye className="h-3.5 w-3.5 text-muted-foreground" />{l.views.toLocaleString()}</span></RailRow>
        <RailRow label="Leads"><span className="flex items-center gap-1.5 px-1.5 text-[14px] tabular-nums"><Inbox className="h-3.5 w-3.5 text-muted-foreground" />{l.leadCount}{l.newLeadCount ? <span className="text-sm font-medium text-primary">{l.newLeadCount} new</span> : null}</span></RailRow>
        <RailRow label="Applications"><span className="flex items-center gap-1.5 px-1.5 text-[14px] tabular-nums"><UsersRound className="h-3.5 w-3.5 text-muted-foreground" />{l.applicationCount}{l.openApplicationCount ? <span className="text-sm text-muted-foreground">{l.openApplicationCount} open</span> : null}</span></RailRow>
        {l.views > 0 && <RailRow label="Lead rate"><span className="px-1.5 text-[14px] tabular-nums text-muted-foreground">{((l.leadCount / l.views) * 100).toFixed(1)}% of views</span></RailRow>}
      </RailSection>

      <RailSection title="Public link">
        {l.publicUrl ? (
          <>
            <p className="truncate px-1.5 text-sm text-muted-foreground" title={l.publicUrl}>{l.publicUrl.replace(/^https?:\/\//, '')}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button type="button" className={chip} onClick={() => void copyText(l.publicUrl!, 'Listing link copied')}><Copy className="h-3.5 w-3.5 text-muted-foreground" /> Copy link</button>
              <a href={l.publicUrl} target="_blank" rel="noreferrer" className={cn(chip, l.status !== 'Published' && 'pointer-events-none opacity-50')} aria-disabled={l.status !== 'Published'}><ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /> Open</a>
              {l.applyUrl && <button type="button" className={chip} onClick={() => void copyText(l.applyUrl!, 'Application link copied')}><Copy className="h-3.5 w-3.5 text-muted-foreground" /> Copy apply link</button>}
            </div>
            {l.status !== 'Published' && <p className="px-1.5 pt-1 text-sm text-muted-foreground">The link works once the listing is published.</p>}
          </>
        ) : (
          <p className="px-1.5 text-sm text-muted-foreground">
            /homes/{l.slug}
            <br />
            The full link appears once the resident portal has been opened and its address is known.
          </p>
        )}
      </RailSection>
    </>
  );
}
