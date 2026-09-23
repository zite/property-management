import {
  Bug, DoorOpen, Droplets, FileBadge, FileCheck2, FileImage, FileText, Hammer, House, IdCard, KeyRound, Layers, Leaf, Paintbrush, Receipt, Refrigerator, ScrollText, ShieldAlert, ShieldCheck, Sparkles, Thermometer, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import type { Tone } from '@project/shared/tone';
import { parseDay, shortDate } from './format';

/**
 * Words and pictures for the resident area. Staff vocabulary ("In progress",
 * "Month-to-month", "Deposit application") becomes what a resident would say.
 */

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  New: { label: 'Received', tone: 'info', hint: 'We have your request and will schedule it soon.' },
  Scheduled: { label: 'Scheduled', tone: 'accent', hint: 'A visit is booked. We’ll message you if anything changes.' },
  'In progress': { label: 'In progress', tone: 'warning', hint: 'Someone is working on it.' },
  'On hold': { label: 'On hold', tone: 'neutral', hint: 'Waiting on parts or a follow-up visit. We’ll keep you posted.' },
  Completed: { label: 'Done', tone: 'success', hint: 'The work is finished. Let us know how it went.' },
  Canceled: { label: 'Canceled', tone: 'neutral', hint: 'This request was canceled.' },
};

export const requestStatus = (s: string) => REQUEST_STATUS[s] ?? { label: s, tone: 'neutral' as Tone, hint: '' };

export type CategoryMeta = { value: string; label: string; icon: LucideIcon; hint: string };

/** The categories a resident chooses from (Turnover is an office-only job). */
export const REQUEST_CATEGORIES: CategoryMeta[] = [
  { value: 'Plumbing', label: 'Plumbing', icon: Droplets, hint: 'Leaks, clogs, toilets, water heater' },
  { value: 'Electrical', label: 'Electrical', icon: Zap, hint: 'Outlets, switches, lights, breakers' },
  { value: 'HVAC', label: 'Heating & cooling', icon: Thermometer, hint: 'Furnace, AC, thermostat, vents' },
  { value: 'Appliance', label: 'Appliances', icon: Refrigerator, hint: 'Fridge, oven, dishwasher, washer' },
  { value: 'Doors & windows', label: 'Doors & windows', icon: DoorOpen, hint: 'Sticking, broken glass, screens' },
  { value: 'Locks & keys', label: 'Locks & keys', icon: KeyRound, hint: 'Lockouts, keys, fobs, mailbox' },
  { value: 'Pest control', label: 'Pests', icon: Bug, hint: 'Ants, mice, roaches, wasps' },
  { value: 'Safety', label: 'Safety', icon: ShieldAlert, hint: 'Smoke or CO alarms, railings' },
  { value: 'Flooring', label: 'Flooring', icon: Layers, hint: 'Carpet, tile, loose boards' },
  { value: 'Painting', label: 'Walls & paint', icon: Paintbrush, hint: 'Holes, peeling, water stains' },
  { value: 'Roofing', label: 'Roof & ceiling', icon: House, hint: 'Leaks from above, gutters' },
  { value: 'Landscaping', label: 'Outdoors', icon: Leaf, hint: 'Yard, snow, trees, sprinklers' },
  { value: 'Cleaning', label: 'Cleaning', icon: Sparkles, hint: 'Common areas, trash, spills' },
  { value: 'General', label: 'Something else', icon: Wrench, hint: 'Anything not listed here' },
];

export const categoryMeta = (value: string): CategoryMeta => REQUEST_CATEGORIES.find(c => c.value === value) ?? { value, label: value, icon: value === 'Turnover' ? Hammer : Wrench, hint: '' };

export const URGENCY = [
  { value: 'High', label: 'As soon as possible', hint: 'It’s getting in the way of daily life.' },
  { value: 'Normal', label: 'In the next few days', hint: 'It needs fixing, but it isn’t urgent.' },
  { value: 'Low', label: 'Whenever convenient', hint: 'A small thing — no rush.' },
] as const;

export const EMERGENCY_EXAMPLES = ['Flooding or a leak you can’t stop', 'No heat when it’s cold outside', 'A gas smell', 'No power, or sparks from an outlet', 'Sewage backing up', 'A door or window that won’t lock'];

export const PRIORITY_WORDS: Record<string, string> = { Emergency: 'Emergency', High: 'Urgent', Normal: 'Normal', Low: 'Not urgent' };

export const LEASE_PHASE: Record<string, { label: string; tone: Tone }> = {
  Draft: { label: 'Being prepared', tone: 'neutral' },
  'Pending signature': { label: 'Waiting for signatures', tone: 'accent' },
  Upcoming: { label: 'Starts soon', tone: 'info' },
  Current: { label: 'Active', tone: 'success' },
  Expiring: { label: 'Ending soon', tone: 'warning' },
  Notice: { label: 'Moving out', tone: 'warning' },
  'Month-to-month': { label: 'Month to month', tone: 'info' },
  Ended: { label: 'Ended', tone: 'neutral' },
  Canceled: { label: 'Canceled', tone: 'neutral' },
};

export const leasePhase = (p: string) => LEASE_PHASE[p] ?? { label: p, tone: 'neutral' as Tone };

export const DOCUMENT_CATEGORY: Record<string, { label: string; icon: LucideIcon; order: number }> = {
  Lease: { label: 'Lease', icon: ScrollText, order: 0 },
  Addendum: { label: 'Addenda', icon: FileCheck2, order: 1 },
  Notice: { label: 'Notices', icon: FileText, order: 2 },
  Inspection: { label: 'Inspections', icon: FileCheck2, order: 3 },
  Insurance: { label: 'Renters insurance', icon: ShieldCheck, order: 4 },
  Receipt: { label: 'Receipts', icon: Receipt, order: 5 },
  Statement: { label: 'Statements', icon: Receipt, order: 6 },
  Invoice: { label: 'Invoices', icon: Receipt, order: 7 },
  Identification: { label: 'Identification', icon: IdCard, order: 8 },
  Photo: { label: 'Photos', icon: FileImage, order: 9 },
  Other: { label: 'Other', icon: FileBadge, order: 10 },
};

export const documentCategory = (c: string) => DOCUMENT_CATEGORY[c] ?? DOCUMENT_CATEGORY.Other;

/** What a resident may file with the office. */
export const UPLOAD_CATEGORIES = [
  { value: 'Insurance', label: 'Renters insurance' },
  { value: 'Identification', label: 'ID or proof of income' },
  { value: 'Notice', label: 'A signed notice or letter' },
  { value: 'Receipt', label: 'A receipt' },
  { value: 'Photo', label: 'Photos' },
  { value: 'Other', label: 'Something else' },
] as const;

export const CONDITION_TONE: Record<string, Tone> = { Excellent: 'success', Good: 'success', Fair: 'warning', Poor: 'danger', Damaged: 'danger', Missing: 'danger', 'N/A': 'neutral' };

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function fileSize(bytes: number | null | undefined) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const isImage = (name: string, url = '') => /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i.test(name) || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) || /images\.unsplash\.com/.test(url);

/** "in 17 days", "tomorrow", "today", "3 days ago". */
export function relativeDays(day: string | null | undefined) {
  if (!day) return '';
  const d = differenceInCalendarDays(parseDay(day), new Date());
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export const daysUntil = (day: string | null | undefined) => (day ? differenceInCalendarDays(parseDay(day), new Date()) : null);

/** "Thursday, Sep 18 at 9:00 AM" — a visit, the way people plan around it. */
export function visitTime(isoString: string | null | undefined) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "EEEE, MMM d 'at' h:mm a" : "EEEE, MMM d, yyyy 'at' h:mm a");
}

/** "Apr 1, 2026 – Mar 31, 2027". */
export function dateRange(start: string | null | undefined, end: string | null | undefined) {
  const f = (d: string) => format(parseDay(d), 'MMM d, yyyy');
  if (start && end) return `${f(start)} – ${f(end)}`;
  if (start) return `From ${f(start)}`;
  return '';
}

export const dayLabel = (d: string | null | undefined) => (d ? shortDate(d) : '');

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** "Good morning" by the resident's own clock. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
