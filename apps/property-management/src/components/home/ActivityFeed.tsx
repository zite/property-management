import { Activity as ActivityIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Avatar, MemberAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import type { FeedItem } from './data';

/** What the team (and residents, owners, vendors and the system itself) did most recently, across the organization. */
export function ActivityFeed({ items }: { items: FeedItem[] }) {
  const ws = useWorkspace();
  if (!items.length) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center">
        <ActivityIcon className="mb-2 h-4 w-4 text-muted-foreground" />
        <p className="text-[14px] font-medium">No activity yet</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Work orders, payments, leases and applications show up here as your team works.</p>
      </div>
    );
  }
  return (
    <ol className="divide-y divide-border/60">
      {items.map(a => {
        const member = a.actorId ? ws.memberById.get(a.actorId) : undefined;
        const name = member?.name ?? a.actorName ?? 'System';
        const context = a.context ?? (a.unitId ? ws.unitLabel(a.unitId) : a.propertyId ? ws.propertyName(a.propertyId) : null);
        const body = (
          <>
            <span className="mt-0.5 shrink-0">{member ? <MemberAvatar member={member} size={20} /> : <Avatar name={name} size={20} color={a.actorName ? '#64748b' : '#0d9488'} />}</span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13.5px] leading-[20px] text-muted-foreground">
                <span className="font-medium text-foreground">{name}</span> {a.summary}
              </span>
              {context && <span className="mt-0.5 block truncate text-sm text-foreground/80">{context}</span>}
            </span>
            <Tip label={dateTime(a.occurredAt)}>
              <span className="shrink-0 whitespace-nowrap pt-0.5 text-[12.5px] tabular-nums text-faint">{timeAgo(a.occurredAt)}</span>
            </Tip>
          </>
        );
        return (
          <li key={a.id}>
            {a.to ? (
              <Link to={a.to} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent/50">{body}</Link>
            ) : (
              <div className="flex items-start gap-2.5 px-4 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
