import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Clock, FileText, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { updateVendorProfile, uploadVendorDocument } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { AreaSkeleton, LoadError, PageHeader, Panel } from '../../components/owner/kit';
import { useVendorProfile, vendorKeys, type VendorProfile } from '../../components/vendor/data';
import { FilePickerField, useFilePicks } from '../../components/vendor/files';
import { useReturnFocus } from '../../components/owner/useReturnFocus';
import { Button, Container, FieldRow, StatusPill, inputClass, textareaClass } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { qk } from '../../lib/queries';
import { longDate, shortDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The vendor's company record: how the office reaches them, and their
 * compliance paperwork — a W-9 and a current certificate of insurance — with
 * what's verified and what's waiting for the office to check.
 */
export default function VendorProfilePage() {
  useDocumentTitle('Company');
  const q = useVendorProfile();
  const [upload, setUpload] = useState<'W-9' | 'Insurance' | 'Other' | null>(null);
  if (q.isPending) return <AreaSkeleton variant="detail" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your company details" home={{ to: '/vendor', label: 'Work orders' }} />;
  const d = q.data;

  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow={d.vendor.trade || 'Vendor'} title={d.vendor.name} subtitle={`${d.stats.openWorkOrders} open ${d.stats.openWorkOrders === 1 ? 'job' : 'jobs'} · ${d.stats.completedThisYear} completed this year`} />
      <Container className="pb-4 pt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-5">
            <ContactForm d={d} />
            <Documents d={d} onUpload={() => setUpload('Other')} />
          </div>
          <aside className="min-w-0 space-y-5">
            <Insurance d={d} onUpload={() => setUpload('Insurance')} />
            <W9 d={d} onUpload={() => setUpload('W-9')} />
          </aside>
        </div>
      </Container>
      <UploadDialog kind={upload} onClose={() => setUpload(null)} today={d.today} />
    </div>
  );
}

function ContactForm({ d }: { d: VendorProfile }) {
  const qc = useQueryClient();
  const nameId = useId();
  const phoneId = useId();
  const addressId = useId();
  const [form, setForm] = useState({ contactName: d.vendor.contactName, phone: d.vendor.phone, address: d.vendor.address });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm({ contactName: d.vendor.contactName, phone: d.vendor.phone, address: d.vendor.address }), [d.vendor.contactName, d.vendor.phone, d.vendor.address]);
  const dirty = form.contactName !== d.vendor.contactName || form.phone !== d.vendor.phone || form.address !== d.vendor.address;

  const save = useMutation({
    mutationFn: () => updateVendorProfile({ contactName: form.contactName.trim(), phone: form.phone.trim(), address: form.address.trim() }),
    onSuccess: r => {
      qc.setQueryData<VendorProfile>(vendorKeys.profile, old => (old ? { ...old, vendor: { ...old.vendor, contactName: r.contactName, phone: r.phone, address: r.address } } : old));
      toast.success(r.changed ? 'Contact details saved. The office will use these from now on.' : 'Nothing changed.');
      setError(null);
    },
    onError: e => setError(errorMessage(e, 'Your changes didn’t save. Try again.')),
  });

  return (
    <Panel title="Contact details" icon={Building2} description="How the office reaches you about jobs and payments">
      <form
        className="space-y-4"
        onSubmit={e => {
          e.preventDefault();
          if (!form.contactName.trim()) {
            setError('Enter a contact name.');
            return;
          }
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow id={nameId} label="Contact name">
            <input id={nameId} value={form.contactName} maxLength={120} autoComplete="name" onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} className={inputClass()} />
          </FieldRow>
          <FieldRow id={phoneId} label="Phone">
            <input id={phoneId} type="tel" value={form.phone} maxLength={40} autoComplete="tel" onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputClass()} />
          </FieldRow>
        </div>
        <FieldRow id={addressId} label="Mailing address" hint="Where checks are sent.">
          <textarea id={addressId} value={form.address} maxLength={300} rows={3} autoComplete="street-address" onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={textareaClass('min-h-[88px]')} />
        </FieldRow>
        <div className="rounded-lg bg-muted/60 px-3.5 py-2.5 text-sm text-muted-foreground">
          You sign in as <span className="font-medium text-foreground">{d.vendor.email}</span>. To change it, or your tax details, contact {d.office.name}
          {d.office.phone ? ` at ${d.office.phone}` : ''}.
        </div>
        {error && (
          <p role="alert" className="text-sm text-tone-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => setForm({ contactName: d.vendor.contactName, phone: d.vendor.phone, address: d.vendor.address })} disabled={save.isPending}>
              Discard
            </Button>
          )}
          <Button type="submit" variant="ink" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ComplianceCard({ icon, title, status, children, action }: { icon: typeof ShieldCheck; title: string; status: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Panel title={title} icon={icon} action={status}>
      <div className="text-[15px]">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </Panel>
  );
}

function Insurance({ d, onUpload }: { d: VendorProfile; onUpload: () => void }) {
  const i = d.compliance.insurance;
  const tone = i.status === 'Current' ? 'success' : i.status === 'Expiring soon' ? 'warning' : 'danger';
  return (
    <ComplianceCard
      icon={ShieldCheck}
      title="Certificate of insurance"
      status={<StatusPill tone={tone}>{i.status === 'Missing' ? 'Not on file' : i.status}</StatusPill>}
      action={
        <Button variant={i.status !== 'Current' && !i.pendingReview ? 'primary' : 'secondary'} className="w-full" onClick={onUpload}>
          <Upload aria-hidden /> Upload a new certificate
        </Button>
      }
    >
      {i.expiresOn ? (
        <p>
          {i.status === 'Expired' ? 'Expired' : 'Expires'} <span className="font-medium">{longDate(i.expiresOn)}</span>
        </p>
      ) : (
        <p>The office doesn’t have a certificate for you yet.</p>
      )}
      {i.pendingReview && i.pendingExpiresOn ? (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-tone-info/[0.07] px-3 py-2 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-tone-info" aria-hidden />
          <span>We received your new certificate (expires {shortDate(i.pendingExpiresOn)}). The office will update your file after checking it.</span>
        </p>
      ) : i.status !== 'Current' ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" aria-hidden />
          <span>The office can’t assign new work without a current certificate.</span>
        </p>
      ) : null}
    </ComplianceCard>
  );
}

function W9({ d, onUpload }: { d: VendorProfile; onUpload: () => void }) {
  const w = d.compliance.w9;
  return (
    <ComplianceCard
      icon={FileText}
      title="W-9"
      status={w.onFile ? <StatusPill tone="success">On file</StatusPill> : w.pendingReview ? <StatusPill tone="info">In review</StatusPill> : <StatusPill tone={w.required ? 'danger' : 'neutral'}>Needed</StatusPill>}
      action={
        !w.onFile && (
          <Button variant={w.pendingReview ? 'secondary' : 'primary'} className="w-full" onClick={onUpload}>
            <Upload aria-hidden /> {w.pendingReview ? 'Upload a corrected W-9' : 'Upload your W-9'}
          </Button>
        )
      }
    >
      {w.onFile ? (
        <p className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-tone-success" aria-hidden />
          <span>Your W-9 is on file. Contact the office if your tax details change.</span>
        </p>
      ) : w.pendingReview ? (
        <p>We received your W-9. The office will mark it on file after checking it.</p>
      ) : (
        <p>{w.required ? 'The office needs a signed W-9 before it can pay you and file your 1099.' : 'Upload a signed W-9 so the office has your tax details.'}</p>
      )}
    </ComplianceCard>
  );
}

function Documents({ d, onUpload }: { d: VendorProfile; onUpload: () => void }) {
  return (
    <Panel
      title="Your documents"
      icon={FileText}
      flush
      action={
        <Button size="sm" variant="secondary" onClick={onUpload}>
          <Upload aria-hidden /> Upload
        </Button>
      }
    >
      {d.documents.length === 0 ? (
        <p className="px-5 py-8 text-center text-[15px] text-muted-foreground">No documents yet. Licenses, W-9s and insurance certificates you send will be listed here.</p>
      ) : (
        <ul className="divide-y">
          {d.documents.map(doc => (
            <li key={doc.id}>
              <a href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-accent/60 sm:px-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                  {doc.kind === 'Insurance' ? <ShieldCheck className="h-[18px] w-[18px]" aria-hidden /> : <FileText className="h-[18px] w-[18px]" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium leading-snug">{doc.name}</span>
                  <span className="block text-sm text-muted-foreground">{[doc.kind === 'Other' ? 'Document' : doc.kind, doc.uploadedAt ? `Added ${shortDate(doc.uploadedAt)}` : null, doc.expiresOn ? `Expires ${shortDate(doc.expiresOn)}` : null].filter(Boolean).join(' · ')}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function UploadDialog({ kind, onClose, today }: { kind: 'W-9' | 'Insurance' | 'Other' | null; onClose: () => void; today: string }) {
  const qc = useQueryClient();
  const fileId = useId();
  const dateId = useId();
  const labelId = useId();
  const [expiresOn, setExpiresOn] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState<{ file?: string; date?: string; label?: string; form?: string }>({});
  const file = useFilePicks(1);
  const open = kind !== null;
  const returnFocus = useReturnFocus(open);

  useEffect(() => {
    if (open) {
      setExpiresOn('');
      setLabel('');
      setErrors({});
      file.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  const send = useMutation({
    mutationFn: uploadVendorDocument,
    onSuccess: doc => {
      qc.invalidateQueries({ queryKey: vendorKeys.profile });
      qc.invalidateQueries({ queryKey: qk.vendor });
      toast.success(doc.kind === 'W-9' ? 'W-9 sent. The office will mark it on file after checking it.' : doc.kind === 'Insurance' ? 'Certificate sent. The office will update your insurance date after checking it.' : 'Document sent to the office.');
      onClose();
    },
    onError: e => setErrors({ form: errorMessage(e, 'The upload didn’t go through. Try again.') }),
  });

  const submit = () => {
    const f = file.items[0];
    const next: typeof errors = {};
    if (!f) next.file = 'Choose a file to upload.';
    else if (f.status === 'uploading') next.file = 'Wait for the file to finish uploading.';
    else if (f.status === 'error') next.file = 'The file didn’t upload. Retry or choose it again.';
    if (kind === 'Insurance') {
      if (!expiresOn) next.date = 'Enter the date the certificate expires.';
      else if (expiresOn < today) next.date = 'That date has passed. Upload your current certificate.';
    }
    if (kind === 'Other' && !label.trim()) next.label = 'Name the document so the office knows what it is.';
    setErrors(next);
    if (Object.keys(next).length || !f?.url || !kind) return;
    send.mutate({ kind, label: kind === 'Other' ? label.trim() : null, expiresOn: kind === 'Insurance' ? expiresOn : null, file: { url: f.url, name: f.name, size: f.size, type: f.type || null } });
  };

  const title = kind === 'W-9' ? 'Upload your W-9' : kind === 'Insurance' ? 'Upload a certificate of insurance' : 'Upload a document';
  return (
    <Dialog open={open} onOpenChange={o => !o && !send.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-md gap-0 overflow-y-auto rounded-xl p-6" onCloseAutoFocus={returnFocus}>
        <DialogTitle className="pr-6 text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[15px] text-muted-foreground">
          {kind === 'Insurance' ? 'The office checks it and updates your file — usually within a business day.' : kind === 'W-9' ? 'Use the current IRS form, signed and dated.' : 'A license, a certification, or anything else the office asked for.'}
        </DialogDescription>
        <form
          className="mt-5 space-y-4"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          {kind === 'Other' && (
            <FieldRow id={labelId} label="What is it?" error={errors.label}>
              <input id={labelId} value={label} maxLength={120} placeholder="Colorado plumbing license" onChange={e => setLabel(e.target.value)} aria-invalid={Boolean(errors.label) || undefined} className={inputClass()} />
            </FieldRow>
          )}
          <FieldRow id={fileId} label="File" error={errors.file}>
            <FilePickerField picks={file} id={fileId} accept="application/pdf,image/*" max={1} label="Choose a PDF or photo" hint="Up to 20 MB" invalid={Boolean(errors.file)} />
          </FieldRow>
          {kind === 'Insurance' && (
            <FieldRow id={dateId} label="Expiration date" error={errors.date}>
              <input id={dateId} type="date" value={expiresOn} min={today} onChange={e => setExpiresOn(e.target.value)} aria-invalid={Boolean(errors.date) || undefined} className={inputClass('max-w-[220px]')} />
            </FieldRow>
          )}
          {errors.form && (
            <p role="alert" className={cn('rounded-lg bg-tone-danger/[0.07] px-3 py-2 text-sm text-tone-danger')}>
              {errors.form}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={send.isPending} disabled={file.uploading}>
              Send to the office
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
