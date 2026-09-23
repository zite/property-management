import { CheckCheck, Inbox } from 'lucide-react';
import { useState } from 'react';
import { useInboxActions } from '../components/inbox/data';
import { InboxView } from '../components/inbox/InboxView';
import { Kbd, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';

/** The signed-in member's notifications: what happened that needs them, newest first. */
export function InboxPage() {
  const { markAllRead } = useInboxActions();
  const [unread, setUnread] = useState<number | null>(null);
  useDocumentTitle(unread ? `Inbox (${unread})` : 'Inbox');

  return (
    <>
      <PageHeader
        icon={<Inbox />}
        title="Inbox"
        actions={
          <Tip label="Mark all read" keys={['⇧', 'E']}>
            <button type="button" disabled={!unread} onClick={() => void markAllRead()} className="ghost-chip h-8 gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
              <CheckCheck className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Mark all read</span>
              <Kbd className="ml-0.5 hidden lg:inline-flex">⇧E</Kbd>
            </button>
          </Tip>
        }
      />
      <InboxView onUnreadCount={setUnread} />
    </>
  );
}
