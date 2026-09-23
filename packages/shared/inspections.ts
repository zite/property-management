import type { ITEM_CONDITIONS } from './constants';

/**
 * Inspection checklists. An inspection stores its areas as JSON: each area (a
 * room) has items, each item a condition, notes and photos. Move-in and
 * move-out inspections of the same unit use the same item ids, so the
 * move-out screen can show "Good at move-in → Damaged now" side by side.
 */

export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export type InspectionItem = { id: string; name: string; condition: ItemCondition | null; notes: string; photos: Array<{ url: string; name: string }> };
export type InspectionArea = { id: string; name: string; items: InspectionItem[] };

const item = (area: string, name: string): InspectionItem => ({ id: `${area}.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, condition: null, notes: '', photos: [] });

function area(id: string, name: string, items: string[]): InspectionArea {
  return { id, name, items: items.map(i => item(id, i)) };
}

/** A sensible default checklist for a residential unit, sized by bedrooms and bathrooms. */
export function defaultAreas(beds = 1, baths = 1): InspectionArea[] {
  const areas: InspectionArea[] = [
    area('entry', 'Entry & hallways', ['Front door & locks', 'Walls', 'Flooring', 'Lighting', 'Smoke detector']),
    area('living', 'Living room', ['Walls & ceiling', 'Flooring', 'Windows & screens', 'Blinds', 'Outlets & switches']),
    area('kitchen', 'Kitchen', ['Countertops', 'Cabinets & drawers', 'Sink & faucet', 'Refrigerator', 'Range & oven', 'Dishwasher', 'Flooring']),
  ];
  for (let b = 1; b <= Math.max(0, Math.round(beds)); b++) {
    areas.push(area(`bedroom-${b}`, `Bedroom ${b}`, ['Walls & ceiling', 'Flooring', 'Closet & doors', 'Windows & screens', 'Outlets & switches']));
  }
  const fullBaths = Math.max(1, Math.floor(baths));
  for (let b = 1; b <= fullBaths; b++) {
    areas.push(area(`bath-${b}`, fullBaths === 1 ? 'Bathroom' : `Bathroom ${b}`, ['Toilet', 'Sink & vanity', 'Tub / shower', 'Exhaust fan', 'Flooring', 'Mirror & fixtures']));
  }
  areas.push(area('systems', 'Systems & safety', ['Heating', 'Air conditioning', 'Water heater', 'Carbon monoxide detector', 'Fire extinguisher']));
  return areas;
}

export function parseAreas(raw: unknown): InspectionArea[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as InspectionArea[]) : [];
  } catch {
    return [];
  }
}

/** Counts for a progress bar and a summary line. */
export function areaStats(areas: InspectionArea[]) {
  const items = areas.flatMap(a => a.items);
  const rated = items.filter(i => i.condition);
  const issues = items.filter(i => i.condition === 'Poor' || i.condition === 'Damaged' || i.condition === 'Missing');
  return { total: items.length, rated: rated.length, issues: issues.length, photos: items.reduce((n, i) => n + i.photos.length, 0) };
}
