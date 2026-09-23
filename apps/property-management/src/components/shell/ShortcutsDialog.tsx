import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@project/components/ui/dialog';
import { MOD } from '../../lib/hotkeys';
import { Kbd } from '../primitives/bits';

/** Every shortcut in one searchable sheet (`?`). Areas' shortcuts are listed here so people can discover them. */
const GROUPS: Array<{ title: string; items: Array<{ label: string; keys: string[]; then?: boolean }> }> = [
  {
    title: 'General',
    items: [
      { label: 'Command menu', keys: [MOD, 'K'] },
      { label: 'New work order', keys: ['C'] },
      { label: 'Search in current list', keys: ['/'] },
      { label: 'Keyboard shortcuts', keys: ['?'] },
      { label: 'Toggle sidebar', keys: ['['] },
      { label: 'Toggle theme', keys: [MOD, '⇧', 'L'] },
      { label: 'Submit a form', keys: [MOD, '↵'] },
    ],
  },
  {
    title: 'Go to',
    items: [
      { label: 'Home', keys: ['G', 'H'], then: true },
      { label: 'Inbox', keys: ['G', 'I'], then: true },
      { label: 'My tasks', keys: ['G', 'T'], then: true },
      { label: 'Messages', keys: ['G', 'M'], then: true },
      { label: 'Work orders', keys: ['G', 'W'], then: true },
      { label: 'Vendors', keys: ['G', 'V'], then: true },
      { label: 'Leasing', keys: ['G', 'A'], then: true },
      { label: 'Leases', keys: ['G', 'L'], then: true },
      { label: 'Residents', keys: ['G', 'R'], then: true },
      { label: 'Properties', keys: ['G', 'P'], then: true },
      { label: 'Owners', keys: ['G', 'O'], then: true },
      { label: 'Accounting', keys: ['G', 'B'], then: true },
      { label: 'Reports', keys: ['G', 'E'], then: true },
      { label: 'Settings', keys: ['G', ','], then: true },
    ],
  },
  {
    title: 'Lists',
    items: [
      { label: 'Move focus', keys: ['J', 'K'] },
      { label: 'Select / deselect', keys: ['X'] },
      { label: 'Extend selection', keys: ['⇧', 'J'] },
      { label: 'Select all', keys: [MOD, 'A'] },
      { label: 'Open', keys: ['↵'] },
      { label: 'Peek', keys: ['Space'] },
      { label: 'Clear selection', keys: ['Esc'] },
    ],
  },
  {
    title: 'Work orders',
    items: [
      { label: 'Change status', keys: ['S'] },
      { label: 'Set priority', keys: ['P'] },
      { label: 'Assign', keys: ['A'] },
      { label: 'Assign to me', keys: ['I'] },
      { label: 'Choose vendor', keys: ['V'] },
      { label: 'Set due date', keys: ['D'] },
      { label: 'Schedule a visit', keys: ['⇧', 'D'] },
      { label: 'Mark completed', keys: [MOD, '⇧', '↵'] },
      { label: 'Open full page from peek', keys: ['⇧', '↵'] },
      { label: 'Previous / next on the page', keys: ['K', 'J'] },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { label: 'Receive a payment', keys: ['⇧', 'P'] },
      { label: 'Charge a resident', keys: ['⇧', 'H'] },
    ],
  },
  {
    title: 'Inbox',
    items: [
      { label: 'Next / previous', keys: ['J', 'K'] },
      { label: 'Open and mark read', keys: ['↵'] },
      { label: 'Archive', keys: ['E'] },
      { label: 'Mark read / unread', keys: ['U'] },
      { label: 'Snooze', keys: ['H'] },
      { label: 'Mark all read', keys: ['⇧', 'E'] },
    ],
  },
  {
    title: 'Tasks',
    items: [
      { label: 'New task', keys: ['N'] },
      { label: 'Open task', keys: ['↵'] },
      { label: 'Mark done / reopen', keys: [MOD, '⇧', '↵'] },
      { label: 'Change task status', keys: ['S'] },
      { label: 'Set task priority', keys: ['P'] },
      { label: 'Assign task', keys: ['A'] },
      { label: 'Take the task', keys: ['I'] },
      { label: 'Set task due date', keys: ['D'] },
    ],
  },
  {
    title: 'Messages',
    items: [
      { label: 'Next / previous conversation', keys: ['J', 'K'] },
      { label: 'Reply', keys: ['↵'] },
      { label: 'Mark conversation unread', keys: ['U'] },
      { label: 'Mark conversation read', keys: ['E'] },
      { label: 'New message', keys: ['N'] },
      { label: 'Back to the list from the composer', keys: ['Esc'] },
      { label: 'New announcement', keys: ['N'] },
    ],
  },
  {
    title: 'Leases & residents',
    items: [
      { label: 'Message residents', keys: ['M'] },
      { label: 'Offer renewal', keys: ['R'] },
      { label: 'Record notice', keys: ['N'] },
      { label: 'Edit resident', keys: ['E'] },
      { label: 'Previous / next lease or resident', keys: ['K', 'J'] },
      { label: 'Back to the list', keys: ['Esc'] },
    ],
  },
  {
    title: 'Portfolio',
    items: [
      { label: 'Edit property, unit or owner', keys: ['E'] },
      { label: 'Set property manager', keys: ['A'] },
      { label: 'Set unit readiness', keys: ['S'] },
      { label: 'Next / previous unit', keys: ['J', 'K'] },
    ],
  },
  {
    title: 'Maintenance',
    items: [
      { label: 'Edit vendor or schedule', keys: ['E'] },
      { label: 'Choose inspector', keys: ['A'] },
      { label: 'Next / previous inspection item', keys: ['J', 'K'] },
      { label: 'Rate the item', keys: ['1', '6'] },
      { label: 'Add a note to the item', keys: ['N'] },
    ],
  },
  {
    title: 'Leasing',
    items: [
      { label: 'Application status', keys: ['S'] },
      { label: 'Assign application or lead', keys: ['A'] },
      { label: 'Set move-in date', keys: ['M'] },
      { label: 'Take the application or lead', keys: ['I'] },
      { label: 'Schedule a showing', keys: ['⇧', 'S'] },
      { label: 'Reply to a lead', keys: ['R'] },
    ],
  },
  {
    title: 'Settings',
    items: [{ label: 'Save changes', keys: [MOD, 'S'] }],
  },
  {
    title: 'Home',
    items: [
      { label: 'Move through Needs attention', keys: ['J', 'K'] },
      { label: 'Open item', keys: ['↵'] },
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 sm:rounded-xl">
        <DialogHeader className="border-b px-5 pb-3 pt-4">
          <DialogTitle className="text-[16px]">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="sr-only">Every keyboard shortcut in the app</DialogDescription>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search shortcuts…" className="field mt-2" />
        </DialogHeader>
        <div className="grid max-h-[62vh] gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {GROUPS.map(g => {
            const items = g.items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()));
            if (!items.length) return null;
            return (
              <div key={g.title}>
                <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</div>
                {items.map(i => (
                  <div key={i.label} className="flex h-9 items-center justify-between border-b border-border/50 text-[14px] last:border-0">
                    <span>{i.label}</span>
                    <span className="flex items-center gap-1">
                      {i.keys.map((k, n) => (
                        <span key={n} className="flex items-center gap-1">
                          {i.then && n > 0 && <span className="text-2xs text-muted-foreground">then</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
