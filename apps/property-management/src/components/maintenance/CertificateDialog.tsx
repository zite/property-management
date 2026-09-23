import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveVendor } from 'zitejs/api';
import { uploadFile } from 'zitejs/upload';
import { errorMessage } from '../../lib/errors';
import { shortDate } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field } from '../form/fields';
import { FormDialog } from '../form/FormDialog';

const MAX = 25 * 1024 * 1024;

/**
 * File a vendor's certificate of insurance: the document goes into their
 * documents (category Insurance, with its expiry) and their insurance
 * expiration is updated in the same step.
 */
export function CertificateDialog({ open, onOpenChange, vendor }: { open: boolean; onOpenChange: (o: boolean) => void; vendor: { id: string; name: string; insuranceExpiresOn: string | null } }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ file?: string; expiresOn?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setExpiresOn(null);
      setErrors({});
    }
  }, [open]);

  const submit = async () => {
    const next: typeof errors = {};
    if (!file) next.file = 'Choose the certificate file.';
    if (!expiresOn) next.expiresOn = 'Enter the date the policy expires.';
    else if (expiresOn < ws.today) next.expiresOn = 'That date has passed — upload the current certificate.';
    if (Object.keys(next).length) return setErrors(next);
    setPending(true);
    try {
      const { fileUrl } = await uploadFile({ data: file!, filename: file!.name });
      if (!fileUrl) throw new Error('The upload didn’t finish. Try again.');
      await saveVendor({ action: 'certificate', id: vendor.id, expiresOn: expiresOn!, file: { url: fileUrl, name: file!.name, size: file!.size, type: file!.type || null } });
      invalidate(qc, 'vendors', 'documents', 'bootstrap');
      toast.success('Certificate filed', { description: `${vendor.name}’s insurance now expires ${shortDate(expiresOn)}.` });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t file the certificate'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Upload certificate of insurance" description={`Filed in ${vendor.name}’s documents, and their insurance expiration is updated.`} onSubmit={submit} pending={pending} submitLabel="File certificate" size="sm">
      <div className="space-y-4">
        <Field label="Certificate" error={errors.file}>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > MAX) return setErrors(x => ({ ...x, file: `${f.name} is over 25 MB.` }));
              setFile(f);
              setErrors(x => ({ ...x, file: undefined }));
            }}
          />
          {file ? (
            <div className="flex h-9 items-center gap-2 rounded-md border bg-subtle px-2.5 text-[14px]">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <button type="button" data-autofocus onClick={() => input.current?.click()} className={`flex h-20 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[14px] text-muted-foreground hover:bg-accent/40 hover:text-foreground ${errors.file ? 'border-tone-danger' : ''}`}>
              <FileUp className="h-4 w-4" /> Choose a PDF or photo
            </button>
          )}
        </Field>
        <Field label="Policy expires" error={errors.expiresOn} hint={vendor.insuranceExpiresOn ? `Currently on file: ${shortDate(vendor.insuranceExpiresOn)}` : 'No certificate on file yet.'}>
          <DateInput value={expiresOn} onChange={v => { setExpiresOn(v); setErrors(x => ({ ...x, expiresOn: undefined })); }} min={ws.today} invalid={Boolean(errors.expiresOn)} />
        </Field>
      </div>
    </FormDialog>
  );
}
