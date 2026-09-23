import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveView } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import type { Filters, ListOptions } from '../../lib/listState';
import { invalidate } from '../../lib/queries';
import { Field, SwitchRow, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';

export type ViewScope = 'work_orders' | 'leases' | 'residents' | 'applications' | 'tasks' | 'units';
export type ViewConfig = { filters: Filters; options: Partial<ListOptions> };

/** Parse a saved view's JSON config; a corrupt config opens as an unfiltered list rather than crashing. */
export function parseViewConfig(config: string | null | undefined): ViewConfig {
  try {
    const parsed = JSON.parse(config || '{}');
    return { filters: parsed.filters ?? {}, options: parsed.options ?? {} };
  } catch {
    return { filters: {}, options: {} };
  }
}

/**
 * Save the current filters and display options as a named view that appears
 * in the sidebar. Any list can offer it — pass its scope and current config.
 */
export function SaveViewDialog({ open, onOpenChange, scope, config, existing }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ViewScope;
  config: ViewConfig;
  /** Rename/share an existing view instead of creating one. */
  existing?: { id: string; name: string; shared: boolean } | null;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setShared(existing?.shared ?? false);
    setError(null);
  }, [open, existing]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name the view.');
      return;
    }
    setPending(true);
    try {
      if (existing) {
        await saveView({ action: 'update', id: existing.id, name: name.trim(), shared, config: { filters: config.filters, options: config.options } });
        toast.success('View updated');
      } else {
        const res = await saveView({ action: 'create', name: name.trim(), scope, shared, config: { filters: config.filters, options: config.options } });
        toast.success(`Saved “${name.trim()}”`, { description: 'It’s in your sidebar under Views.' });
        navigate(`/views/${res.id}`);
      }
      invalidate(qc, 'bootstrap');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t save the view'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={existing ? 'Edit view' : 'Save as view'} description={existing ? undefined : 'Keep these filters and display options one click away.'} onSubmit={submit} pending={pending} submitLabel={existing ? 'Save changes' : 'Save view'} size="sm">
      <div className="space-y-4">
        <Field label="Name" error={error} htmlFor="view-name">
          <TextInput id="view-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Emergencies at The Alder" invalid={Boolean(error)} maxLength={80} />
        </Field>
        <SwitchRow label="Share with the team" description="Everyone sees shared views in their sidebar." checked={shared} onChange={setShared} />
      </div>
    </FormDialog>
  );
}
