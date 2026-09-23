import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { Pdf } from 'zitejs/pdf';
import type { LeasePhase } from '@project/shared/constants';
import { daysBetween, formatDay, termMonths } from '@project/shared/dates';
import { leaseMergeContext, renderLeaseTerms, type LeaseDocInput } from '@project/shared/leaseDocument';
import { leasePhase, leaseRef } from '@project/shared/leases';
import { formatAddress, joinNames, type MergeContext } from '@project/shared/merge';
import { formatMoney } from '@project/shared/money';
import type { Actor } from '@project/shared/server/actor';
import { membersWith } from '@project/shared/server/actor';
import { sendTriggered, type Recipient } from '@project/shared/server/email';
import { activateLease, overlappingLeases, parseSignatures, recordSignature } from '@project/shared/server/leases';
import { lateFeeFor, portalLink, type OrgSettings } from '@project/shared/server/settings';
import { bool, day, iso, num, numOrNull, ref, str, withRetry } from '@project/shared/server/sql';

/**
 * Leases on the staff side: the row every lease endpoint reads, the merge
 * values its emails and agreement use, and the messages that go to the people
 * on it. The lifecycle itself (create, activate, renew, notice) lives in the
 * shared engine; this file is the glue the staff endpoints share.
 */

export type StaffLease = ReturnType<typeof toStaffLease>;

export function toStaffLease(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    number: numOrNull(r.number),
    name: str(r.name) ?? '',
    status: str(r.status) || 'Draft',
    leaseType: str(r.leaseType) || 'Fixed term',
    propertyId: ref(r.propertyId) ?? '',
    unitId: ref(r.unitId) ?? '',
    propertyName: str(r.propertyName) ?? '',
    unitName: str(r.unitName) ?? '',
    street: str(r.street) ?? '',
    city: str(r.city) ?? '',
    state: str(r.state) ?? '',
    postalCode: str(r.postalCode) ?? '',
    managerId: ref(r.managerId),
    startDate: day(r.startDate),
    endDate: day(r.endDate),
    moveInDate: day(r.moveInDate),
    moveOutDate: day(r.moveOutDate),
    noticeGivenOn: day(r.noticeGivenOn),
    rent: num(r.rent),
    deposit: num(r.deposit),
    rentDueDay: num(r.rentDueDay, 1),
    lateFeeExempt: bool(r.lateFeeExempt),
    renewalStatus: str(r.renewalStatus) || 'None',
    renewalRent: numOrNull(r.renewalRent),
    renewalTermMonths: numOrNull(r.renewalTermMonths),
    renewalOfferedAt: iso(r.renewalOfferedAt),
    renewalExpiresOn: day(r.renewalExpiresOn),
    renewalRespondedAt: iso(r.renewalRespondedAt),
    previousLeaseId: ref(r.previousLeaseId),
    applicationId: ref(r.applicationId),
    terms: str(r.terms) ?? '',
    sentForSignatureAt: iso(r.sentForSignatureAt),
    signatures: parseSignatures(r.signatures),
    signedAt: iso(r.signedAt),
    countersignedAt: iso(r.countersignedAt),
    countersignedById: ref(r.countersignedById),
    documentUrl: ref(r.documentUrl),
    moveOutReason: str(r.moveOutReason) ?? '',
    forwardingAddress: str(r.forwardingAddress) ?? '',
    depositSettledAt: iso(r.depositSettledAt),
    createdById: ref(r.createdById),
    notes: str(r.notes) ?? '',
    createdAt: iso(r.created_at),
  };
}

export async function loadStaffLease(id: string) {
  const { rows } = await zite.sql({
    query: `
      SELECT l.*, p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", p."managerId", u."name" AS "unitName"
      FROM "Leases" l
      LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
      LEFT JOIN "Units" u ON u.id::text = l."unitId"
      WHERE l.id::text = $1 LIMIT 1`,
    params: [id],
  });
  if (!rows[0]) throw new ZiteError('That lease no longer exists.', 'NOT_FOUND');
  return toStaffLease(rows[0]);
}

export type LeasePerson = { linkId: string; id: string; name: string; email: string; phone: string; role: string; signedAt: string | null; portalSeenAt: string | null; portalInvitedAt: string | null; color: string };

const ROLE_ORDER = `CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 WHEN 'Occupant' THEN 2 ELSE 3 END`;

export async function leasePeople(leaseId: string): Promise<LeasePerson[]> {
  const { rows } = await zite.sql({
    query: `
      SELECT lt.id AS "linkId", lt."role", lt."signedAt", t.id, t."name", t."email", t."phone", t."portalSeenAt", t."portalInvitedAt", t."color"
      FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId"
      WHERE lt."leaseId" = $1
      ORDER BY ${ROLE_ORDER}, lt.created_at ASC`,
    params: [leaseId],
  });
  return rows.map(r => ({
    linkId: String(r.linkId),
    id: String(r.id),
    name: str(r.name) ?? '',
    email: str(r.email) ?? '',
    phone: str(r.phone) ?? '',
    role: str(r.role) || 'Primary',
    signedAt: iso(r.signedAt),
    portalSeenAt: iso(r.portalSeenAt),
    portalInvitedAt: iso(r.portalInvitedAt),
    color: str(r.color) ?? '',
  }));
}

export const isSigner = (p: { role: string }) => p.role === 'Primary' || p.role === 'Co-tenant';

export function phaseFor(l: Pick<StaffLease, 'status' | 'leaseType' | 'startDate' | 'endDate' | 'noticeGivenOn' | 'moveOutDate'>, today: string, settings: Pick<OrgSettings, 'renewalNoticeDays'>): LeasePhase {
  return leasePhase({ status: l.status, leaseType: l.leaseType, startDate: l.startDate, endDate: l.endDate, noticeGivenOn: l.noticeGivenOn, moveOutDate: l.moveOutDate }, today, settings.renewalNoticeDays || 60);
}

export const daysLeft = (endDate: string | null, today: string) => (endDate ? daysBetween(today, endDate) : null);

export function docInput(l: StaffLease, people: LeasePerson[], settings: OrgSettings): LeaseDocInput {
  return {
    organizationName: settings.organizationName,
    currency: settings.currency,
    gracePeriodDays: settings.gracePeriodDays,
    lateFee: lateFeeFor(settings, l.rent),
    property: { name: l.propertyName, street: l.street, city: l.city, state: l.state, postalCode: l.postalCode },
    unitName: l.unitName,
    tenantNames: people.filter(p => p.role !== 'Guarantor').map(p => p.name),
    startDate: l.startDate ?? '',
    endDate: l.endDate,
    rent: l.rent,
    deposit: l.deposit,
    rentDueDay: l.rentDueDay,
  };
}

export const renderTerms = (l: StaffLease, people: LeasePerson[], settings: OrgSettings) => renderLeaseTerms(settings.leaseTemplate, docInput(l, people, settings));

export const homeLabel = (l: Pick<StaffLease, 'propertyName' | 'unitName'>) => (l.unitName && !/^(main|house|home)$/i.test(l.unitName) ? `${l.propertyName} ${l.unitName.replace(/^unit\s+/i, '#')}` : l.propertyName);

/** Merge values for any template sent about a lease. */
export function leaseMerge(l: StaffLease, people: LeasePerson[], settings: OrgSettings): MergeContext {
  return {
    ...leaseMergeContext(docInput(l, people, settings)),
    property_name: l.propertyName,
    unit_name: l.unitName,
    unit_address: formatAddress({ street: l.street, city: l.city, state: l.state, postalCode: l.postalCode }, l.unitName),
    tenant_names: joinNames(people.filter(p => p.role !== 'Guarantor').map(p => p.name)),
  };
}

export const recipientOf = (p: LeasePerson): Recipient => ({ kind: 'tenant', id: p.id, name: p.name || 'Resident', email: p.email || null });

export type SendTally = { sent: number; failed: number; noEmail: number; templateOff: boolean };

/**
 * Send one of the organization's templates to the signers on a lease. Nothing
 * is sent when the template is switched off; the tally says so, so the UI can
 * tell the person rather than implying residents were emailed.
 */
export async function sendLeaseTemplate(input: {
  trigger: 'Signature request' | 'Renewal offer' | 'Welcome';
  lease: StaffLease;
  people: LeasePerson[];
  settings: OrgSettings;
  actor: Actor;
  extra?: MergeContext;
  hashPath?: string;
  buttonLabel?: string;
  only?: (p: LeasePerson) => boolean;
}): Promise<SendTally> {
  const tally: SendTally = { sent: 0, failed: 0, noEmail: 0, templateOff: false };
  const link = portalLink(input.settings, input.hashPath ?? '/resident/lease');
  const context: MergeContext = { ...leaseMerge(input.lease, input.people, input.settings), ...(link ? { portal_link: link } : {}), ...input.extra };
  for (const p of input.people.filter(p => isSigner(p) && (!input.only || input.only(p)))) {
    if (!p.email) {
      tally.noEmail++;
      continue;
    }
    const res = await withRetry(() =>
      sendTriggered({
        trigger: input.trigger,
        settings: input.settings,
        recipient: recipientOf(p),
        context,
        leaseId: input.lease.id,
        propertyId: input.lease.propertyId || null,
        senderMemberId: input.actor.id,
        button: link ? { label: input.buttonLabel ?? 'Open the portal', href: link } : null,
      }),
    );
    if (!res) {
      tally.templateOff = true;
      break;
    }
    if (res.delivery === 'Failed') tally.failed++;
    else tally.sent++;
  }
  return tally;
}

/** Who on the team hears about a lease: its property's manager, else the people who run properties. */
export async function leaseWatchers(l: Pick<StaffLease, 'managerId'>) {
  if (l.managerId) return [l.managerId];
  const people = await membersWith('residents.manage');
  return people.filter(p => p.role === 'Admin' || p.role === 'Property Manager').map(p => p.id);
}

export const moneyText = (n: number, settings: OrgSettings) => formatMoney(n, settings.currency);
export const leaseTitle = (l: Pick<StaffLease, 'number'>) => leaseRef(l.number);
export { formatDay, termMonths };

/** A lease that isn't in one of these statuses can't be acted on this way. */
export function requireStatus(l: StaffLease, allowed: string[], message: string) {
  if (!allowed.includes(l.status)) throw new ZiteError(message, 'BAD_REQUEST');
}

// ── Lifecycle steps shared by creating a lease and acting on one ───────────

/**
 * Send a draft for signature: the agreement is rendered from the template and
 * frozen onto the lease (what residents sign never changes if the template is
 * edited later), and each signer gets the Signature request email.
 */
export async function sendForSignature(actor: Actor, leaseId: string, settings: OrgSettings, opts: { resend?: boolean } = {}) {
  let lease = await loadStaffLease(leaseId);
  const people = await leasePeople(leaseId);
  if (!people.some(isSigner)) throw new ZiteError('Add a primary resident before sending the lease for signature.', 'BAD_REQUEST');
  if (lease.status === 'Draft') {
    const terms = lease.terms || renderTerms(lease, people, settings);
    await withRetry(() => zite.leases.update({ id: leaseId, record: { status: 'Pending signature', terms, sentForSignatureAt: new Date().toISOString() } }));
    lease = { ...lease, status: 'Pending signature', terms };
  } else if (lease.status !== 'Pending signature') {
    throw new ZiteError('Only a draft or a lease waiting for signatures can be sent for signature.', 'BAD_REQUEST');
  } else if (opts.resend) {
    await withRetry(() => zite.leases.update({ id: leaseId, record: { sentForSignatureAt: new Date().toISOString() } }));
  }
  const tally = await sendLeaseTemplate({ trigger: 'Signature request', lease, people, settings, actor, buttonLabel: 'Review and sign', only: p => !p.signedAt });
  return { lease, people, tally };
}

/** Minimal Markdown for the agreement PDF: headings, paragraphs, bold, lists. Everything is escaped first. */
export function agreementHtml(markdown: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const block of markdown.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const h = /^(#{1,4})\s+(.*)$/.exec(t);
      const li = /^[-*]\s+(.*)$/.exec(t);
      if (h) {
        flush();
        out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      } else if (li) {
        list.push(li[1]);
      } else {
        flush();
        out.push(`<p>${inline(t)}</p>`);
      }
    }
    flush();
  }
  return out.join('\n');
}

/** Render the signed agreement with its signature block and file it on the lease, shared with the residents. Best-effort. */
export async function fileSignedAgreement(actor: Actor, lease: StaffLease, people: LeasePerson[], settings: OrgSettings) {
  try {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const sigs = lease.signatures;
    const rows = people
      .filter(isSigner)
      .map(p => {
        const s = sigs.find(x => x.tenantId === p.id);
        const when = s?.signedAt ?? p.signedAt;
        return `<tr><td>${esc(p.name)}</td><td>${esc(p.role)}</td><td>${s ? `<span class="sig">${esc(s.name)}</span>` : '—'}</td><td>${when ? formatDay(when.slice(0, 10), 'long') : 'Not signed'}${s?.by === 'staff' ? ' · recorded by the office' : ''}</td></tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:48px;font-size:12.5px;line-height:1.6}
      h1{font-size:22px;margin:0 0 12px} h2{font-size:15px;margin:22px 0 6px} p{margin:0 0 10px}
      .meta{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#555;margin-bottom:28px}
      table{width:100%;border-collapse:collapse;margin-top:10px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11.5px}
      th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left} .sig{font-family:'Brush Script MT',cursive;font-size:16px}
    </style></head><body>
      <div class="meta">${esc(settings.organizationName)} · ${esc(leaseRef(lease.number))} · ${esc(homeLabel(lease))}</div>
      ${agreementHtml(lease.terms || renderTerms(lease, people, settings))}
      <h2>Signatures</h2>
      <table><thead><tr><th>Resident</th><th>Role</th><th>Signature</th><th>Signed</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="margin-top:18px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11.5px">Countersigned for ${esc(settings.organizationName)} by ${esc(actor.name)} on ${formatDay(new Date().toISOString().slice(0, 10), 'long')}.</p>
    </body></html>`;
    const filename = `Lease ${leaseRef(lease.number)} ${homeLabel(lease)}.pdf`.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-');
    const { url } = await Pdf.renderHtml({ html, filename });
    if (!url) return null;
    const primary = people.find(p => p.role === 'Primary') ?? people[0];
    await withRetry(() => zite.leases.update({ id: lease.id, record: { documentUrl: url } }));
    await withRetry(() =>
      zite.documents.create({
        record: {
          name: filename, url, category: 'Lease', propertyId: lease.propertyId || null, unitId: lease.unitId || null, leaseId: lease.id, tenantId: primary?.id ?? null,
          sharedWithTenant: true, sharedWithOwner: false, uploadedById: actor.id, uploadedByName: actor.name, mimeType: 'application/pdf', uploadedAt: new Date().toISOString(),
        },
      }),
    );
    return url;
  } catch (e) {
    console.error('Signed lease PDF failed', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Countersign and activate: record any signatures the office collected on
 * paper, make the lease Active (the engine posts the deposit, a prorated first
 * month and anything recurring that's due), file the signed agreement, mark a
 * linked application Leased and, if asked, send the Welcome email.
 */
export async function countersignAndActivate(actor: Actor, leaseId: string, settings: OrgSettings, opts: { signAll?: boolean; sendWelcome?: boolean; today: string }) {
  let lease = await loadStaffLease(leaseId);
  let people = await leasePeople(leaseId);
  if (lease.status === 'Draft') {
    if (!people.some(isSigner)) throw new ZiteError('Add a primary resident before activating the lease.', 'BAD_REQUEST');
    const terms = lease.terms || renderTerms(lease, people, settings);
    await withRetry(() => zite.leases.update({ id: leaseId, record: { status: 'Pending signature', terms } }));
    lease = { ...lease, status: 'Pending signature', terms };
  }
  requireStatus(lease, ['Pending signature'], lease.status === 'Active' ? 'This lease is already active.' : 'An ended or canceled lease can’t be activated.');
  const unsigned = people.filter(p => isSigner(p) && !p.signedAt);
  if (unsigned.length && !opts.signAll) {
    throw new ZiteError(`${joinNames(unsigned.map(p => p.name))} ${unsigned.length === 1 ? 'hasn’t' : 'haven’t'} signed yet. Record their signature first, or mark everyone as signed.`, 'BAD_REQUEST');
  }
  const conflicts = await overlappingLeases(lease.unitId, lease.startDate ?? opts.today, lease.endDate, [leaseId]);
  if (conflicts.length) throw new ZiteError(`${conflicts[0].name || 'Another lease'} already covers those dates for this unit. Record its move-out date first.`, 'CONFLICT');
  for (const p of unsigned) await withRetry(() => recordSignature(leaseId, p.id, p.name.trim().length >= 2 ? p.name : 'Resident', 'staff'));

  const { posted } = await activateLease(leaseId, { actorId: actor.id, timezone: settings.timezone });
  await withRetry(() => zite.leases.update({ id: leaseId, record: { countersignedAt: new Date().toISOString(), countersignedById: actor.id } }));
  lease = await loadStaffLease(leaseId);
  people = await leasePeople(leaseId);
  const documentUrl = lease.documentUrl ?? (await fileSignedAgreement(actor, lease, people, settings));

  if (lease.applicationId) {
    const { rows } = await zite.sql({ query: `SELECT "status", "leaseId" FROM "Applications" WHERE id::text = $1`, params: [lease.applicationId] });
    if (rows[0] && (rows[0].status !== 'Leased' || ref(rows[0].leaseId) !== leaseId)) {
      await withRetry(() => zite.applications.update({ id: lease.applicationId!, record: { status: 'Leased', leaseId, lastActivityAt: new Date().toISOString() } }));
    }
  }
  const welcome = opts.sendWelcome ? await sendLeaseTemplate({ trigger: 'Welcome', lease, people, settings, actor, hashPath: '/resident' }) : null;
  return { lease, people, posted, documentUrl, welcome, recorded: unsigned.length };
}
