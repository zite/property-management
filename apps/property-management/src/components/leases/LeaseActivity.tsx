import { useQueryClient } from '@tanstack/react-query';
import { Lock, Mail, MessageSquare } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { messageResident } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { Composer, Timeline, type ComposerMode } from '../detail/Timeline';
import { lk, type LeaseDetail } from './data';

/** The lease's history with the residents' conversation, and a composer that writes to everyone on the lease. */
export function LeaseActivity({ detail }: { detail: LeaseDetail }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const l = detail.lease;
  const signers = detail.people.filter(p => p.role === 'Primary' || p.role === 'Co-tenant');
  const primary = detail.people.find(p => p.role === 'Primary') ?? detail.people[0];
  const firstNames = signers.map(p => p.name.split(' ')[0]).join(' & ');

  useEffect(() => {
    if (detail.unread > 0 && detail.people.length) {
      void messageResident({ action: 'read', tenantIds: detail.people.map(p => p.id).slice(0, 20) })
        .then(() => {
          void qc.invalidateQueries({ queryKey: lk.detail(l.id) });
          invalidate(qc, 'bootstrap', 'inbox', 'messages', 'residents');
        })
        .catch(() => undefined);
    }
  }, [l.id, detail.unread]);

  const modes: ComposerMode[] = [
    ...(signers.length && ws.can('communications.send') ? [
      { value: 'email', label: `Message ${firstNames || 'residents'}`, icon: <Mail />, placeholder: `Write to ${signers.map(p => p.name).join(', ')}…`, hint: signers.some(p => !p.email) ? 'Emailed where we have an address, and shown in their portal.' : 'Emailed and shown in their portal.' },
      { value: 'portal', label: 'Portal only', icon: <MessageSquare />, placeholder: 'Shown in their portal next time they sign in…', hint: 'Not emailed — they see it in the portal.' },
    ] : []),
    ...(primary ? [{ value: 'note', label: 'Internal note', icon: <Lock />, placeholder: 'Add a note for your team…' }] : []),
  ];

  const send = async ({ mode, body }: { mode: string; body: string }) => {
    try {
      if (mode === 'note') {
        await messageResident({ action: 'note', tenantId: primary!.id, leaseId: l.id, body });
      } else {
        const res = await messageResident({ action: 'send', tenantIds: signers.map(p => p.id), leaseId: l.id, body, subject: `About your lease at ${ws.unitLabel(l.unitId, l.propertyId)}`, portalOnly: mode === 'portal' });
        if (res.failed) toast.warning(res.message);
        else toast.success(res.message);
      }
      await qc.invalidateQueries({ queryKey: lk.detail(l.id) });
      invalidate(qc, 'messages', 'residents');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send'));
      throw e;
    }
  };

  return (
    <div>
      <Timeline activity={detail.activity} messages={detail.messages} emptyText="Nothing has happened on this lease yet." />
      {modes.length > 0 && <Composer className="mt-4" modes={modes} onSend={send} />}
    </div>
  );
}
