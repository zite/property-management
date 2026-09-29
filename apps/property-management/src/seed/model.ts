import { addDays, addMonths, addPeriods, daysBetween, daysInMonth, periodEnd, periodOf, periodStart } from '@project/shared/dates';
import { defaultAreas, type InspectionArea } from '@project/shared/inspections';

/**
 * The demo organization, as data.
 *
 * Everything is described relative to "today" and built from a fixed-seed
 * PRNG, so every phase of the seed rebuilds exactly the same model and finds
 * what earlier phases wrote by natural key (a property's code, a lease's
 * number, a vendor's name). A template installed a year from now still has
 * rent due this month, a lease expiring soon and a work order from this morning.
 *
 * People use reserved example domains, except the admin who loads it, who is
 * linked in as a resident, an owner and a vendor so the portal has something
 * to show them the moment they sign in.
 */

export const SEED_TIMEZONE = 'America/Denver';
export const SAMPLE_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
export const img = (id: string, w = 1200, h = 800) => `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&q=80`;

export type SeedActor = { id: string; name: string; email: string };

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the seed names the default chart's two bank accounts, and removing the demo puts back. */
export const SEED_BANKS: Record<string, { name: string; bankName: string; last4: string }> = {
  operating_bank: { name: 'Operating — Front Range Community Bank', bankName: 'Front Range Community Bank', last4: '4821' },
  deposit_bank: { name: 'Deposit Trust — Front Range Community Bank', bankName: 'Front Range Community Bank', last4: '7730' },
};

/** The profile the seed gives the admin who loads it, when theirs is still empty. */
export const SEED_ADMIN_PROFILE = { title: 'Director of Property Management', phone: '(303) 555-0140' };

export const ORG = {
  organizationName: 'Cedar & Main Property Management',
  legalName: 'Cedar & Main Property Management, LLC',
  address: '2400 Blake St, Suite 310\nDenver, CO 80205',
  phone: '(303) 555-0142',
  emergencyPhone: '(303) 555-0199',
  officeHours: 'Mon–Fri, 9am–5pm',
  supportEmail: 'help@cedarandmain.example.com',
  websiteUrl: 'https://cedarandmain.example.com',
  brandColor: '#0f766e',
  currency: 'USD',
  timezone: SEED_TIMEZONE,
  rentDueDay: 1,
  gracePeriodDays: 5,
  lateFeeType: 'Flat',
  lateFeeAmount: 75,
  lateFeePercent: 5,
  lateFeeMax: 150,
  chargeDaysAhead: 0,
  rentReminderDays: 3,
  renewalNoticeDays: 60,
  managementFeePercent: 8,
  ownerApprovalThreshold: 500,
  applicationFee: 45,
  incomeMultiple: 3,
  portalHeadline: 'Welcome home',
  portalIntro: 'Pay rent, request maintenance, sign your lease and reach our team — all in one place. Looking for a place? Browse homes available now.',
  paymentInstructions: 'Pay online in the portal with a bank account or card. You can also drop a check (payable to Cedar & Main Property Management, unit number in the memo) at our office, 2400 Blake St, Suite 310.',
  emailSignature: 'Cedar & Main Property Management\n(303) 555-0142 · help@cedarandmain.example.com',
};

export const MEMBERS = [
  { name: 'Renata Ortiz', email: 'renata.ortiz@example.com', role: 'Property Manager', title: 'Senior Property Manager', phone: '(303) 555-0171' },
  { name: 'Priya Raman', email: 'priya.raman@example.com', role: 'Property Manager', title: 'Property Manager', phone: '(303) 555-0172' },
  { name: 'Theo Nakamura', email: 'theo.nakamura@example.com', role: 'Leasing Agent', title: 'Leasing Specialist', phone: '(303) 555-0173' },
  { name: 'Grace Adeyemi', email: 'grace.adeyemi@example.com', role: 'Accountant', title: 'Controller', phone: '(303) 555-0174' },
  { name: 'Luis Fernández', email: 'luis.fernandez@example.com', role: 'Maintenance', title: 'Maintenance Coordinator', phone: '(303) 555-0175' },
] as const;

export type OwnerKey = 'ridgeview' | 'hollis' | 'shah' | 'me';

export function owners(actor: SeedActor) {
  return [
    { key: 'ridgeview' as OwnerKey, name: 'Ridgeview Holdings LLC', ownerType: 'Company', contactName: 'Alan Whitfield', email: 'alan.whitfield@ridgeview.example.com', phone: '(720) 555-0161', mailingAddress: '1801 California St, Floor 22\nDenver, CO 80202', taxIdLast4: '4471', managementFeePercent: 7, distributionMethod: 'ACH', color: '#2563eb', notes: 'Prefers a quarterly call to review capital projects. Approves anything over $500 by email.' },
    { key: 'hollis' as OwnerKey, name: 'Hollis Family Trust', ownerType: 'Trust', contactName: 'Margaret Hollis', email: 'margaret.hollis@example.org', phone: '(303) 555-0188', mailingAddress: 'PO Box 1122\nBoulder, CO 80306', taxIdLast4: '9032', managementFeePercent: 8, distributionMethod: 'ACH', color: '#7c3aed', notes: 'Trustee is Margaret Hollis. Keep a $4,000 reserve at Juniper Court for winter.' },
    { key: 'shah' as OwnerKey, name: 'Anika & Daniel Shah', ownerType: 'Individual', contactName: 'Anika Shah', email: 'anika.shah@example.net', phone: '(720) 555-0144', mailingAddress: '5530 Wadsworth Blvd\nArvada, CO 80002', taxIdLast4: '1186', managementFeePercent: 10, distributionMethod: 'Check', color: '#db2777', notes: 'Relocated to Seattle; the Elm Street house is their former home.' },
    { key: 'me' as OwnerKey, name: actor.name, ownerType: 'Individual', contactName: actor.name, email: actor.email, phone: '(303) 555-0150', mailingAddress: '', taxIdLast4: '', managementFeePercent: 10, distributionMethod: 'ACH', color: '#ea580c', notes: 'Demo: this owner is linked to your sign-in, so you can preview the owner portal.' },
  ];
}

type UnitDef = { name: string; beds: number; baths: number; sqft: number; rent: number; floor?: string; type?: string; features?: string[] };

export type PropertyDef = {
  code: string;
  name: string;
  propertyType: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  owner: OwnerKey;
  manager: 'renata' | 'priya' | 'me';
  yearBuilt: number;
  photoUrl: string;
  description: string;
  amenities: string[];
  reserveAmount: number;
  petPolicy: string;
  parking: string;
  acquiredOn: string;
  color: string;
  units: UnitDef[];
};

const alderUnit = (floor: number, n: number): UnitDef => {
  const name = `${floor}0${n}`;
  if (n === 4) return { name, beds: 0, baths: 1, sqft: 480, rent: 1195 + floor * 20, floor: String(floor), type: 'Studio', features: ['Murphy bed', 'Updated kitchen'] };
  if (n === 1 || n === 3) return { name, beds: 2, baths: 1, sqft: 880, rent: 1825 + floor * 25, floor: String(floor), type: '2 bd / 1 ba', features: ['Corner windows', 'Hardwood floors', 'Dishwasher'] };
  return { name, beds: 1, baths: 1, sqft: 650, rent: 1475 + floor * 25, floor: String(floor), type: '1 bd / 1 ba', features: ['Hardwood floors', 'Walk-in closet'] };
};

export const PROPERTIES: PropertyDef[] = [
  {
    code: 'ALD', name: 'The Alder', propertyType: 'Multifamily', street: '1450 N Marion St', city: 'Denver', state: 'CO', postalCode: '80218', owner: 'ridgeview', manager: 'renata',
    yearBuilt: 1962, photoUrl: img('photo-1545324418-cc1a3fa10c00'), reserveAmount: 5000, petPolicy: 'Cats and dogs under 40 lb, $35–$50/mo pet rent', parking: 'Off-street lot, $75/mo', acquiredOn: '2019-06-14', color: '#0d9488',
    description: 'A four-story 1962 brick building two blocks from City Park, fully renovated in 2020 with new windows, kitchens and a courtyard.',
    amenities: ['On-site laundry', 'Bike storage', 'Package lockers', 'Courtyard', 'Controlled entry'],
    units: [1, 2, 3, 4].flatMap(f => [1, 2, 3, 4].map(n => alderUnit(f, n))),
  },
  {
    code: 'JUN', name: 'Juniper Court', propertyType: 'Townhome', street: '3100 S Havana St', city: 'Aurora', state: 'CO', postalCode: '80014', owner: 'hollis', manager: 'priya',
    yearBuilt: 1998, photoUrl: img('photo-1600585154340-be6161a56a0c'), reserveAmount: 4000, petPolicy: 'Pets considered case by case', parking: 'Attached one-car garage per home', acquiredOn: '2016-03-01', color: '#7c3aed',
    description: 'Eight two-story townhomes around a shared green, each with a private patio and attached garage.',
    amenities: ['Attached garage', 'Private patio', 'In-unit washer & dryer', 'Shared green'],
    units: ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'].map(name => (['A1', 'A2', 'A3', 'B1'].includes(name)
      ? { name, beds: 2, baths: 1.5, sqft: 1120, rent: 2150, type: '2 bd / 1.5 ba townhome', features: ['Garage', 'Patio', 'Washer & dryer'] }
      : { name, beds: 3, baths: 2.5, sqft: 1420, rent: 2550, type: '3 bd / 2.5 ba townhome', features: ['Garage', 'Patio', 'Washer & dryer', 'Primary suite'] })),
  },
  {
    code: 'ELM', name: '2217 Elm Street', propertyType: 'Single-family', street: '2217 Elm St', city: 'Lakewood', state: 'CO', postalCode: '80215', owner: 'shah', manager: 'me',
    yearBuilt: 1954, photoUrl: img('photo-1568605114967-8130f3a36994'), reserveAmount: 2500, petPolicy: 'One dog allowed with owner approval', parking: 'Driveway and detached garage', acquiredOn: '2012-08-20', color: '#db2777',
    description: 'A 1950s brick ranch on a quiet street with a fenced backyard, updated kitchen and finished basement.',
    amenities: ['Fenced yard', 'Finished basement', 'Detached garage'],
    units: [{ name: 'Main', beds: 3, baths: 2, sqft: 1640, rent: 2850, type: 'Single-family home', features: ['Fenced yard', 'Basement', 'Gas range'] }],
  },
  {
    code: 'LRK', name: 'Larkspur Lofts', propertyType: 'Mixed-use', street: '820 Santa Fe Dr', city: 'Denver', state: 'CO', postalCode: '80204', owner: 'ridgeview', manager: 'renata',
    yearBuilt: 1924, photoUrl: img('photo-1512917774080-9991f1c4c750'), reserveAmount: 6000, petPolicy: 'No dogs; cats allowed', parking: 'Street parking; permits available', acquiredOn: '2017-11-09', color: '#2563eb',
    description: 'A 1924 printing building in the Art District converted to a ground-floor café and six lofts with 14-foot ceilings.',
    amenities: ['14-ft ceilings', 'Exposed brick', 'Rooftop deck', 'Elevator'],
    units: [
      { name: '1A', beds: 0, baths: 1, sqft: 1800, rent: 3900, type: 'Retail', features: ['Street frontage', 'Grease trap'] },
      ...['2A', '2B', '2C', '3A', '3B', '3C'].map((name, i) => ({ name, beds: 1, baths: 1, sqft: 760 + i * 10, rent: 1725 + (name.startsWith('3') ? 75 : 0) + (i % 3) * 25, floor: name[0], type: '1 bd loft', features: ['Exposed brick', 'Oversized windows', 'Polished concrete floors'] })),
    ],
  },
  {
    code: 'CTW', name: '48 Cottonwood Lane', propertyType: 'Single-family', street: '48 Cottonwood Ln', city: 'Littleton', state: 'CO', postalCode: '80120', owner: 'me', manager: 'me',
    yearBuilt: 1987, photoUrl: img('photo-1570129477492-45c003edd2be'), reserveAmount: 2500, petPolicy: 'Pets allowed with deposit', parking: 'Two-car garage', acquiredOn: '2021-04-30', color: '#ea580c',
    description: 'A four-bedroom family home backing onto greenbelt trails, in the Cottonwood Hills HOA.',
    amenities: ['Two-car garage', 'Backs to greenbelt', 'Central air', 'HOA pool access'],
    units: [{ name: 'Main', beds: 4, baths: 2.5, sqft: 2080, rent: 3150, type: 'Single-family home', features: ['Central air', 'Fireplace', 'Two-car garage'] }],
  },
  {
    code: 'SAB', name: 'Sable Ridge Duplex', propertyType: 'Multifamily', street: '1714 S Pearl St', city: 'Denver', state: 'CO', postalCode: '80210', owner: 'hollis', manager: 'priya',
    yearBuilt: 1978, photoUrl: img('photo-1564013799919-ab600027ffc6'), reserveAmount: 2000, petPolicy: 'Cats allowed', parking: 'Driveway', acquiredOn: '2014-05-12', color: '#ca8a04',
    description: 'An up/down duplex near Platt Park with separate entrances and a shared backyard.',
    amenities: ['Shared backyard', 'Separate entrances', 'Storage'],
    units: [
      { name: 'Upper', beds: 2, baths: 1, sqft: 940, rent: 1695, type: '2 bd / 1 ba', features: ['Vaulted ceilings', 'Balcony'] },
      { name: 'Lower', beds: 2, baths: 1, sqft: 960, rent: 1650, type: '2 bd / 1 ba', features: ['Direct yard access', 'Storage room'] },
    ],
  },
];

export const VENDORS = [
  { name: 'Front Range Plumbing & Drain', trade: 'Plumbing', contactName: 'Rick Alvarez', email: 'dispatch@frontrangeplumbing.example.com', phone: '(303) 555-0120', is1099: true, w9: true, insuranceDays: 210, rate: 115, rating: 4.8, account: 'repairs', terms: 30 },
  { name: 'Mile High Heating & Air', trade: 'HVAC', contactName: 'Sandra Cho', email: 'service@milehighhvac.example.com', phone: '(303) 555-0121', is1099: true, w9: true, insuranceDays: 16, rate: 125, rating: 4.6, account: 'repairs', terms: 30 },
  { name: 'Brightline Electric', trade: 'Electrical', contactName: 'Victor Hale', email: 'office@brightline.example.com', phone: '(720) 555-0122', is1099: true, w9: true, insuranceDays: -4, rate: 135, rating: 4.4, account: 'repairs', terms: 15 },
  { name: 'Summit Appliance Repair', trade: 'Appliance', contactName: '__actor__', email: '__actor__', phone: '(303) 555-0123', is1099: true, w9: true, insuranceDays: 300, rate: 95, rating: 4.7, account: 'repairs', terms: 30 },
  { name: 'Evergreen Grounds Co.', trade: 'Landscaping', contactName: 'Jess Moreno', email: 'jess@evergreengrounds.example.com', phone: '(720) 555-0124', is1099: true, w9: true, insuranceDays: 150, rate: 65, rating: 4.5, account: 'landscaping', terms: 15 },
  { name: 'Spotless Turnover Cleaning', trade: 'Cleaning', contactName: 'Amara Diallo', email: 'book@spotless.example.com', phone: '(303) 555-0125', is1099: true, w9: false, insuranceDays: 95, rate: 55, rating: 4.9, account: 'turnover', terms: 15 },
  { name: 'Brush & Roll Painting', trade: 'Painting', contactName: 'Pete Lindqvist', email: 'pete@brushandroll.example.com', phone: '(720) 555-0126', is1099: true, w9: true, insuranceDays: 120, rate: 60, rating: 4.3, account: 'turnover', terms: 30 },
  { name: 'Guardian Pest Solutions', trade: 'Pest control', contactName: 'Hector Ruiz', email: 'routes@guardianpest.example.com', phone: '(303) 555-0127', is1099: true, w9: true, insuranceDays: 240, rate: 0, rating: 4.6, account: 'pest_control', terms: 30 },
  { name: 'Apex Roofing & Exteriors', trade: 'Roofing', contactName: 'Dana Kowalski', email: 'estimates@apexroofing.example.com', phone: '(720) 555-0128', is1099: true, w9: true, insuranceDays: 330, rate: 0, rating: 4.2, account: 'repairs', terms: 30 },
  { name: 'Clearwater Utilities', trade: 'Utilities', contactName: '', email: 'billing@clearwater.example.com', phone: '(303) 555-0129', is1099: false, w9: false, insuranceDays: null, rate: 0, rating: null, account: 'utilities', terms: 20 },
  { name: 'Front Range Waste Services', trade: 'Utilities', contactName: '', email: 'accounts@frontrangewaste.example.com', phone: '(303) 555-0130', is1099: false, w9: false, insuranceDays: null, rate: 0, rating: null, account: 'utilities', terms: 15 },
  { name: 'Granite Mutual Insurance', trade: 'Insurance', contactName: 'Policy services', email: 'policies@granitemutual.example.com', phone: '(800) 555-0131', is1099: false, w9: false, insuranceDays: null, rate: 0, rating: null, account: 'insurance', terms: 30 },
  { name: 'County Treasurer', trade: 'Other', contactName: '', email: 'treasurer@county.example.gov', phone: '(303) 555-0132', is1099: false, w9: false, insuranceDays: null, rate: 0, rating: null, account: 'property_tax', terms: 30 },
  { name: 'Cottonwood Hills HOA', trade: 'Other', contactName: 'Community manager', email: 'manager@cottonwoodhills.example.org', phone: '(303) 555-0133', is1099: false, w9: false, insuranceDays: null, rate: 0, rating: null, account: 'hoa_dues', terms: 10 },
] as const;

export type Behavior = 'autopay' | 'ontime' | 'late' | 'partial' | 'delinquent';

export type TenantDef = { name: string; email?: string; phone: string; role: 'Primary' | 'Co-tenant' | 'Occupant' | 'Guarantor'; company?: string; pets?: string; vehicles?: string; emergency?: [string, string] };

export type LeasePlan = {
  unit: string; // `${code}-${unitName}`
  tenants: TenantDef[];
  start: string;
  end: string | null;
  leaseType: 'Fixed term' | 'Month-to-month';
  rent: number;
  deposit: number;
  status: 'Active' | 'Ended' | 'Pending signature';
  behavior: Behavior;
  extras: Array<{ key: 'pet_income' | 'parking_income' | 'utility_income'; description: string; amount: number }>;
  moveOut?: string | null;
  noticeGivenOn?: string | null;
  renewal?: { status: 'Offered' | 'Accepted' | 'Declined'; rent: number; termMonths: number; offeredOn: string; expiresOn: string };
  deductions?: Array<{ description: string; amount: number }>;
  depositSettled?: boolean;
  moveOutReason?: string;
  isActor?: boolean;
  number: number;
};

const phone = (n: number) => `(${n % 3 === 0 ? 720 : 303}) 555-${String(1000 + ((n * 37) % 9000)).slice(-4)}`;
const person = (name: string, i: number, role: TenantDef['role'] = 'Primary', extra: Partial<TenantDef> = {}): TenantDef => ({
  name,
  email: `${name.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, '').trim().replace(/\s+/g, '.')}@example.com`,
  phone: phone(i),
  role,
  ...extra,
});

/** The whole portfolio's leases, current and recent. */
export function leasePlans(today: string, actor: SeedActor): LeasePlan[] {
  const M0 = periodOf(today);
  const start = (monthsAgo: number, day = 1) => {
    const p = addPeriods(M0, -monthsAgo);
    const [y, m] = p.split('-').map(Number);
    return `${p}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
  };
  const endOf = (monthsFromNow: number) => {
    const p = addPeriods(M0, monthsFromNow);
    const [y, m] = p.split('-').map(Number);
    return `${p}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
  };
  const term = (s: string, months = 12) => addDays(addMonths(s, months), -1);
  let n = 1000;
  let i = 0;
  const plan = (p: Omit<LeasePlan, 'number' | 'extras' | 'leaseType' | 'end' | 'deposit' | 'status'> & Partial<Pick<LeasePlan, 'extras' | 'leaseType' | 'end' | 'deposit' | 'status'>>): LeasePlan => ({
    extras: [],
    leaseType: 'Fixed term',
    end: term(p.start),
    deposit: p.rent,
    status: 'Active',
    ...p,
    number: ++n,
  });
  const t = (name: string, role: TenantDef['role'] = 'Primary', extra: Partial<TenantDef> = {}) => person(name, ++i, role, extra);
  const utility = { key: 'utility_income' as const, description: 'Water, sewer & trash', amount: 65 };

  return [
    // ── Ended leases (history in the ledger window) ─────────────────────────
    plan({ unit: 'JUN-A2', tenants: [t('Rosa Delgado')], start: start(16), end: endOf(-4), rent: 2100, deposit: 2100, status: 'Ended', behavior: 'partial', moveOut: endOf(-4), deductions: [{ description: 'Carpet cleaning', amount: 225 }], depositSettled: true, moveOutReason: 'Bought a home' }),
    plan({ unit: 'LRK-3B', tenants: [t('Caleb Stone')], start: start(26), end: endOf(-2), rent: 1725, deposit: 1700, status: 'Ended', behavior: 'ontime', moveOut: endOf(-2), deductions: [{ description: 'Move-out cleaning', amount: 150 }], depositSettled: true, moveOutReason: 'Job relocation' }),
    plan({ unit: 'ALD-304', tenants: [t('Owen Price')], start: start(19), end: endOf(-1), rent: 1255, deposit: 1250, status: 'Ended', behavior: 'ontime', moveOut: endOf(-1), deductions: [{ description: 'Carpet cleaning', amount: 180 }, { description: 'Patch and paint bedroom wall', amount: 95 }], depositSettled: true, moveOutReason: 'Moving in with partner' }),
    plan({ unit: 'ALD-102', tenants: [t('Megan Holt')], start: start(23), end: endOf(-1), rent: 1500, deposit: 1500, status: 'Ended', behavior: 'autopay', moveOut: endOf(-1), deductions: [], depositSettled: false, moveOutReason: 'Graduate school in Chicago' }),

    // ── The Alder ──────────────────────────────────────────────────────────
    plan({ unit: 'ALD-101', tenants: [t('Maya Chen', 'Primary', { pets: 'Cat (Miso)' }), t('Jordan Chen', 'Co-tenant')], start: start(7), rent: 1850, behavior: 'ontime', extras: [{ key: 'pet_income', description: 'Pet rent', amount: 35 }, utility] }),
    plan({ unit: 'ALD-103', tenants: [t('Aaliyah Brooks')], start: start(10), rent: 1900, behavior: 'autopay', extras: [utility] }),
    plan({ unit: 'ALD-104', tenants: [t('Sofia Martinez')], start: start(4), rent: 1215, behavior: 'ontime', extras: [utility] }),
    plan({ unit: 'ALD-201', tenants: [{ name: actor.name, email: actor.email, phone: '(303) 555-0150', role: 'Primary', vehicles: 'Blue Subaru Outback', emergency: ['Alex Morgan', '(303) 555-0151'] }], start: start(5), rent: 1875, behavior: 'ontime', extras: [{ key: 'parking_income', description: 'Parking space #14', amount: 75 }, utility], isActor: true }),
    plan({ unit: 'ALD-202', tenants: [t('Kenji Watanabe')], start: start(14), end: null, leaseType: 'Month-to-month', rent: 1480, deposit: 1450, behavior: 'late', extras: [utility] }),
    plan({ unit: 'ALD-203', tenants: [t('Rachel Goldberg'), t('Tom Goldberg', 'Co-tenant')], start: start(11), rent: 1880, behavior: 'ontime', extras: [utility], noticeGivenOn: addDays(today, -12), moveOut: endOf(0), moveOutReason: 'Bought a house in Arvada' }),
    plan({ unit: 'ALD-204', tenants: [t('Nadia Haddad')], start: start(2), rent: 1235, behavior: 'ontime', extras: [utility] }),
    plan({ unit: 'ALD-301', tenants: [t('Liam O’Connor')], start: start(9), rent: 1900, behavior: 'autopay', extras: [{ key: 'parking_income', description: 'Parking space #3', amount: 75 }, utility] }),
    plan({ unit: 'ALD-302', tenants: [t('Priscilla Owusu')], start: start(13), end: null, leaseType: 'Month-to-month', rent: 1540, deposit: 1500, behavior: 'partial', extras: [utility] }),
    plan({ unit: 'ALD-303', tenants: [t('Ben Carter', 'Primary', { pets: 'Dog (Juniper, 32 lb)' }), t('Ava Carter', 'Co-tenant')], start: start(6), rent: 1950, behavior: 'ontime', extras: [{ key: 'pet_income', description: 'Pet rent', amount: 50 }, utility] }),
    plan({ unit: 'ALD-401', tenants: [t('Hiro Tanaka')], start: start(8), rent: 1925, behavior: 'autopay', extras: [utility] }),
    plan({ unit: 'ALD-402', tenants: [t('Grace Kim')], start: start(3), rent: 1575, behavior: 'ontime', extras: [utility] }),
    plan({ unit: 'ALD-403', tenants: [t('Mateo Rossi')], start: start(10), rent: 1950, behavior: 'ontime', extras: [utility] }),
    plan({ unit: 'ALD-404', tenants: [t('Zoe Williams')], start: start(1), rent: 1275, behavior: 'late', extras: [utility] }),

    // ── Juniper Court ──────────────────────────────────────────────────────
    plan({ unit: 'JUN-A1', tenants: [t('Derek Lawson'), t('Monique Lawson', 'Co-tenant')], start: start(9), rent: 2150, behavior: 'ontime' }),
    plan({ unit: 'JUN-A2', tenants: [t('Isabel Fuentes', 'Primary', { vehicles: 'White Honda CR-V' })], start: start(3, 15), rent: 2175, deposit: 2175, behavior: 'ontime' }),
    plan({ unit: 'JUN-A3', tenants: [t('Noah Fischer')], start: start(8), rent: 2150, behavior: 'autopay' }),
    plan({ unit: 'JUN-A4', tenants: [t('Tanya Petrov'), t('Alexei Petrov', 'Co-tenant')], start: start(12), end: null, leaseType: 'Month-to-month', rent: 2525, deposit: 2500, behavior: 'ontime' }),
    plan({ unit: 'JUN-B1', tenants: [t('Kwame Mensah')], start: start(5), rent: 2150, behavior: 'ontime' }),
    plan({ unit: 'JUN-B2', tenants: [t('Laura Bennett')], start: start(10), rent: 2550, behavior: 'delinquent' }),
    plan({ unit: 'JUN-B3', tenants: [t('Chris Albright'), t('Dana Albright', 'Co-tenant')], start: start(12), end: endOf(0), rent: 2500, deposit: 2500, behavior: 'ontime', noticeGivenOn: addDays(today, -40), moveOut: endOf(0), moveOutReason: 'Relocating to Austin' }),
    plan({ unit: 'JUN-B4', tenants: [t('Omar Siddiqui')], start: start(7), rent: 2550, behavior: 'late' }),

    // ── Single-family & duplex ─────────────────────────────────────────────
    plan({ unit: 'ELM-Main', tenants: [t('Linh Nguyen', 'Primary', { pets: 'Dog (Mochi)' }), t('Bao Nguyen', 'Co-tenant')], start: start(9), rent: 2850, deposit: 3200, behavior: 'autopay' }),
    plan({ unit: 'CTW-Main', tenants: [t('Colin Hartley'), t('Erin Hartley', 'Co-tenant')], start: start(10, 1), end: addDays(today, 54), rent: 3150, deposit: 3150, behavior: 'ontime' }),
    plan({ unit: 'SAB-Upper', tenants: [t('Wyatt Morgan')], start: start(30), end: null, leaseType: 'Month-to-month', rent: 1650, deposit: 1500, behavior: 'ontime' }),
    plan({ unit: 'SAB-Lower', tenants: [t('Fatima Al-Sayed')], start: start(11), rent: 1650, behavior: 'ontime', renewal: { status: 'Offered', rent: 1715, termMonths: 12, offeredOn: addDays(today, -6), expiresOn: addDays(today, 16) } }),

    // ── Larkspur Lofts ─────────────────────────────────────────────────────
    plan({ unit: 'LRK-1A', tenants: [t('Elena Vasquez', 'Primary', { company: 'Grindstone Coffee Co.' })], start: start(20), end: addMonths(start(20), 60), rent: 3900, deposit: 7800, behavior: 'ontime' }),
    plan({ unit: 'LRK-2A', tenants: [t('Samuel Okafor')], start: start(8), rent: 1725, behavior: 'ontime' }),
    plan({ unit: 'LRK-2B', tenants: [t('Ivy Thompson')], start: start(6), rent: 1750, behavior: 'autopay' }),
    plan({ unit: 'LRK-2C', tenants: [t('Marcus Reid')], start: start(11), rent: 1775, behavior: 'partial' }),
    plan({ unit: 'LRK-3A', tenants: [t('Julia Novak')], start: start(4), rent: 1800, behavior: 'ontime' }),
    plan({ unit: 'LRK-3C', tenants: [t('Andre Dubois')], start: start(9), rent: 1850, behavior: 'ontime', renewal: { status: 'Accepted', rent: 1895, termMonths: 12, offeredOn: addDays(today, -20), expiresOn: addDays(today, -5) } }),

    // ── Upcoming: approved applicant for the Albrights' townhome ───────────
    plan({ unit: 'JUN-B3', tenants: [t('Sam Rivera'), t('Jess Rivera', 'Co-tenant')], start: periodStart(addPeriods(M0, 1)), rent: 2550, deposit: 2550, status: 'Pending signature', behavior: 'ontime' }),
  ];
}

/** Units with no current lease, and what's happening with them. */
export const VACANCIES: Record<string, { readiness: 'Ready' | 'Make ready'; availableInDays: number }> = {
  'ALD-304': { readiness: 'Ready', availableInDays: 0 },
  'ALD-102': { readiness: 'Make ready', availableInDays: 14 },
  'LRK-3B': { readiness: 'Ready', availableInDays: 0 },
};

export type WorkOrderPlan = {
  number: number;
  title: string;
  description: string;
  unit: string; // `${code}-${unit}` or `${code}` for common areas
  category: string;
  priority: 'Emergency' | 'High' | 'Normal' | 'Low';
  status: 'New' | 'Scheduled' | 'In progress' | 'On hold' | 'Completed' | 'Canceled';
  source: 'Portal' | 'Staff' | 'Phone' | 'Email' | 'Inspection' | 'Recurring';
  assignee?: 'luis' | 'renata' | 'priya' | 'me';
  vendor?: string;
  createdDaysAgo: number;
  scheduledInDays?: number;
  completedDaysAgo?: number;
  estimate?: number;
  cost?: number;
  approval?: 'Pending' | 'Approved' | 'Declined';
  permissionToEnter?: boolean;
  entryNotes?: string;
  rating?: number;
  feedback?: string;
  completionNotes?: string;
  fromTenant?: boolean;
  schedule?: string;
  billPaid?: boolean;
};

export function workOrderPlans(): WorkOrderPlan[] {
  let n = 1000;
  const wo = (p: Omit<WorkOrderPlan, 'number'>): WorkOrderPlan => ({ number: ++n, ...p });
  return [
    // History first, so numbers read in time order.
    wo({ title: 'Snow removal — February storm', description: 'Plow lot and shovel walks after 14" of snow. Salted entries twice.', unit: 'ALD', category: 'Landscaping', priority: 'High', status: 'Completed', source: 'Staff', assignee: 'luis', vendor: 'Evergreen Grounds Co.', createdDaysAgo: 205, completedDaysAgo: 204, cost: 650, billPaid: true }),
    wo({ title: 'Kitchen faucet dripping constantly', description: 'Faucet drips even when fully closed. Tenant has a bowl under it.', unit: 'ALD-101', category: 'Plumbing', priority: 'Normal', status: 'Completed', source: 'Portal', assignee: 'luis', vendor: 'Front Range Plumbing & Drain', createdDaysAgo: 196, completedDaysAgo: 192, cost: 285, rating: 5, feedback: 'Fast and tidy. Thank you!', fromTenant: true, permissionToEnter: true, completionNotes: 'Replaced cartridge and supply lines.', billPaid: true }),
    wo({ title: 'Main line backing up into basement drain', description: 'Water coming up through the floor drain when laundry runs.', unit: 'JUN-A1', category: 'Plumbing', priority: 'High', status: 'Completed', source: 'Phone', assignee: 'priya', vendor: 'Front Range Plumbing & Drain', createdDaysAgo: 181, completedDaysAgo: 180, cost: 425, completionNotes: 'Snaked main line, camera showed root intrusion at 40 ft. Recommend hydro-jet in spring.', billPaid: true }),
    wo({ title: 'Roof leak over unit 3C after hail', description: 'Water stain spreading on ceiling near skylight after last night’s hail.', unit: 'LRK-3C', category: 'Roofing', priority: 'High', status: 'Completed', source: 'Portal', assignee: 'renata', vendor: 'Apex Roofing & Exteriors', createdDaysAgo: 150, completedDaysAgo: 141, estimate: 1980, cost: 1980, approval: 'Approved', fromTenant: true, completionNotes: 'Replaced skylight flashing and 60 sq ft of membrane. 5-year workmanship warranty.', billPaid: true }),
    wo({ title: 'Outlet sparking in kitchen', description: 'Outlet next to the stove sparked and now the breaker keeps tripping.', unit: 'ALD-401', category: 'Electrical', priority: 'Emergency', status: 'Completed', source: 'Phone', assignee: 'luis', vendor: 'Brightline Electric', createdDaysAgo: 131, completedDaysAgo: 131, cost: 210, rating: 4, fromTenant: true, completionNotes: 'Replaced damaged outlet with GFCI and checked the circuit.', billPaid: true }),
    wo({ title: 'Turnover clean — A2', description: 'Deep clean after move-out: appliances, bathrooms, floors, windows.', unit: 'JUN-A2', category: 'Turnover', priority: 'High', status: 'Completed', source: 'Staff', assignee: 'priya', vendor: 'Spotless Turnover Cleaning', createdDaysAgo: 121, completedDaysAgo: 118, cost: 450, billPaid: true }),
    wo({ title: 'Patch and paint — A2 turnover', description: 'Patch nail holes, paint living room and both bedrooms (Swiss Coffee).', unit: 'JUN-A2', category: 'Painting', priority: 'High', status: 'Completed', source: 'Staff', assignee: 'priya', vendor: 'Brush & Roll Painting', createdDaysAgo: 121, completedDaysAgo: 116, cost: 1150, approval: 'Approved', billPaid: true }),
    wo({ title: 'Refrigerator not cooling', description: 'Freezer works but fridge side is warm. Food spoiling.', unit: 'LRK-2A', category: 'Appliance', priority: 'High', status: 'Completed', source: 'Portal', assignee: 'luis', vendor: 'Summit Appliance Repair', createdDaysAgo: 104, completedDaysAgo: 102, cost: 240, rating: 5, feedback: 'Came the next morning.', fromTenant: true, permissionToEnter: true, completionNotes: 'Replaced evaporator fan motor.', billPaid: true }),
    wo({ title: 'Fence panel down after windstorm', description: 'Two panels on the east side blew down; dog can get out.', unit: 'ELM-Main', category: 'General', priority: 'High', status: 'Completed', source: 'Email', assignee: 'me', vendor: 'Evergreen Grounds Co.', createdDaysAgo: 96, completedDaysAgo: 93, cost: 540, approval: 'Approved', completionNotes: 'Reset post in concrete and replaced two cedar panels.', billPaid: true }),
    wo({ title: 'Replace smoke detectors building-wide', description: 'Detectors are past their 10-year date. Replace all units and hallways with sealed 10-year models.', unit: 'ALD', category: 'Safety', priority: 'Normal', status: 'Completed', source: 'Inspection', assignee: 'luis', vendor: 'Brightline Electric', createdDaysAgo: 88, completedDaysAgo: 75, cost: 620, approval: 'Approved', billPaid: true }),
    wo({ title: 'Toilet running constantly', description: 'Toilet runs every few minutes all night.', unit: 'SAB-Lower', category: 'Plumbing', priority: 'Low', status: 'Completed', source: 'Portal', assignee: 'luis', createdDaysAgo: 70, completedDaysAgo: 66, cost: 0, rating: 5, fromTenant: true, completionNotes: 'Replaced flapper and fill valve (in-house, parts from stock).' }),
    wo({ title: 'AC blowing warm air', description: 'Air conditioner runs but the air is warm. Upstairs is 84°.', unit: 'JUN-B4', category: 'HVAC', priority: 'High', status: 'Completed', source: 'Portal', assignee: 'priya', vendor: 'Mile High Heating & Air', createdDaysAgo: 62, completedDaysAgo: 60, cost: 395, rating: 3, feedback: 'Fixed, but took two visits.', fromTenant: true, completionNotes: 'Found refrigerant leak at the service valve; repaired and recharged.', billPaid: true }),
    wo({ title: 'Ants in kitchen', description: 'Trail of small ants along the counter and under the sink.', unit: 'ALD-103', category: 'Pest control', priority: 'Normal', status: 'Completed', source: 'Portal', assignee: 'luis', vendor: 'Guardian Pest Solutions', createdDaysAgo: 48, completedDaysAgo: 45, cost: 140, rating: 4, fromTenant: true, billPaid: true }),
    wo({ title: 'Shower valve leaking behind wall', description: 'Water stain in the closet that shares a wall with the shower.', unit: 'ALD-202', category: 'Plumbing', priority: 'High', status: 'Completed', source: 'Staff', assignee: 'luis', vendor: 'Front Range Plumbing & Drain', createdDaysAgo: 34, completedDaysAgo: 31, cost: 365, completionNotes: 'Rebuilt valve, replaced access panel.', billPaid: true }),
    wo({ title: 'Garage door opener stopped working', description: 'Opener hums but the door doesn’t move.', unit: 'CTW-Main', category: 'General', priority: 'Normal', status: 'Completed', source: 'Portal', assignee: 'me', vendor: 'Summit Appliance Repair', createdDaysAgo: 22, completedDaysAgo: 19, cost: 310, rating: 5, fromTenant: true, completionNotes: 'Replaced drive gear and sprocket.', billPaid: true }),
    wo({ title: 'Move-out clean — 304', description: 'Full clean after Owen Price moved out.', unit: 'ALD-304', category: 'Turnover', priority: 'High', status: 'Completed', source: 'Staff', assignee: 'luis', vendor: 'Spotless Turnover Cleaning', createdDaysAgo: 13, completedDaysAgo: 10, cost: 380, billPaid: true }),
    wo({ title: 'Replace cracked window pane', description: 'Bedroom window has a crack across the lower pane.', unit: 'ALD-303', category: 'Doors & windows', priority: 'Normal', status: 'Completed', source: 'Portal', assignee: 'luis', vendor: 'Brightline Electric', createdDaysAgo: 18, completedDaysAgo: 8, cost: 275, fromTenant: true, billPaid: false }),
    wo({ title: 'Noise complaint — upstairs neighbor', description: 'Not a maintenance issue; forwarded to property manager.', unit: 'ALD-203', category: 'General', priority: 'Low', status: 'Canceled', source: 'Portal', assignee: 'renata', createdDaysAgo: 27, fromTenant: true }),

    // ── Open work ──────────────────────────────────────────────────────────
    wo({ title: 'Turnover: paint, carpet clean, new blinds — 102', description: 'Megan Holt moved out. Paint throughout, clean carpets, replace bedroom blinds, touch up kitchen cabinets. Target listing date in two weeks.', unit: 'ALD-102', category: 'Turnover', priority: 'High', status: 'In progress', source: 'Staff', assignee: 'luis', vendor: 'Brush & Roll Painting', createdDaysAgo: 12, scheduledInDays: -2, estimate: 2400, approval: 'Approved' }),
    wo({ title: 'Retail HVAC making grinding noise', description: 'Rooftop unit serving the café is making a loud grinding noise on startup. Café opens at 6am.', unit: 'LRK-1A', category: 'HVAC', priority: 'High', status: 'In progress', source: 'Email', assignee: 'renata', vendor: 'Mile High Heating & Air', createdDaysAgo: 4, scheduledInDays: -1, estimate: 780, approval: 'Approved', fromTenant: true }),
    wo({ title: 'Replace water heater (18 years old, rusting at base)', description: 'Found during a routine visit: 40-gal gas water heater from 2008 with rust at the base and a slow drip from the relief valve. Recommend replacement before it fails.', unit: 'ELM-Main', category: 'Plumbing', priority: 'High', status: 'On hold', source: 'Staff', assignee: 'me', vendor: 'Front Range Plumbing & Drain', createdDaysAgo: 5, estimate: 1850, approval: 'Pending' }),
    wo({ title: 'Window screen torn in living room', description: 'Screen has a tear in the corner; bugs getting in.', unit: 'ALD-204', category: 'Doors & windows', priority: 'Low', status: 'On hold', source: 'Portal', assignee: 'luis', createdDaysAgo: 9, entryNotes: 'Waiting on custom screen from supplier (ETA next week).', fromTenant: true, permissionToEnter: true }),
    wo({ title: 'Water stain spreading on bathroom ceiling', description: 'Brown stain on the bathroom ceiling has doubled in size since Sunday. Unit above is 401.', unit: 'ALD-301', category: 'Plumbing', priority: 'High', status: 'Scheduled', source: 'Portal', assignee: 'luis', vendor: 'Front Range Plumbing & Drain', createdDaysAgo: 2, scheduledInDays: 1, fromTenant: true, permissionToEnter: true, entryNotes: 'Tenant works from home; knock loudly.' }),
    wo({ title: 'Dishwasher not draining', description: 'Standing water in the bottom after every cycle.', unit: 'JUN-A3', category: 'Appliance', priority: 'Normal', status: 'Scheduled', source: 'Portal', assignee: 'priya', vendor: 'Summit Appliance Repair', createdDaysAgo: 3, scheduledInDays: 2, estimate: 180, fromTenant: true, permissionToEnter: true }),
    wo({ title: 'Parking lot light out by entrance', description: 'Pole light nearest the main entrance is out; residents say it’s dark coming home.', unit: 'ALD', category: 'Electrical', priority: 'Normal', status: 'Scheduled', source: 'Staff', assignee: 'luis', vendor: 'Brightline Electric', createdDaysAgo: 6, scheduledInDays: 3 }),
    wo({ title: 'Quarterly pest control — common areas', description: 'Exterior perimeter treatment, trash room and basement bait stations.', unit: 'ALD', category: 'Pest control', priority: 'Low', status: 'Scheduled', source: 'Recurring', assignee: 'luis', vendor: 'Guardian Pest Solutions', createdDaysAgo: 1, scheduledInDays: 5, estimate: 165, schedule: 'Quarterly pest control — common areas' }),
    wo({ title: 'Mildew on bathroom window sill', description: 'Black spots on the window sill and caulk in the upstairs bathroom.', unit: 'JUN-B1', category: 'General', priority: 'Normal', status: 'In progress', source: 'Portal', assignee: 'priya', createdDaysAgo: 7, fromTenant: true, permissionToEnter: true }),
    wo({ title: 'Smoke detector chirping in hallway', description: 'Hallway detector chirps every minute. We can’t reach it — ceiling is 12 ft.', unit: 'CTW-Main', category: 'Safety', priority: 'High', status: 'New', source: 'Portal', createdDaysAgo: 0, fromTenant: true, permissionToEnter: true }),
    wo({ title: 'Front door deadbolt sticking', description: 'Key only turns if you pull the door hard toward you.', unit: 'LRK-2B', category: 'Locks & keys', priority: 'Normal', status: 'New', source: 'Portal', createdDaysAgo: 1, fromTenant: true, permissionToEnter: false, entryNotes: 'Please text before coming — I have a cat that bolts.' }),
    wo({ title: 'Garbage disposal jammed', description: 'Disposal hums but won’t spin.', unit: 'SAB-Upper', category: 'Appliance', priority: 'Low', status: 'New', source: 'Portal', createdDaysAgo: 2, fromTenant: true, permissionToEnter: true }),
    wo({ title: 'Gutter cleaning — spring/fall', description: 'Clean gutters and downspouts on all eight townhomes; check for loose hangers.', unit: 'JUN', category: 'Landscaping', priority: 'Low', status: 'New', source: 'Recurring', createdDaysAgo: 0, estimate: 520, schedule: 'Gutter cleaning' }),
    wo({ title: 'No heat — thermostat blank', description: 'Thermostat screen is blank and the radiator is cold. It’s 58° in the apartment.', unit: 'ALD-402', category: 'HVAC', priority: 'Emergency', status: 'New', source: 'Portal', createdDaysAgo: 0, fromTenant: true, permissionToEnter: true, entryNotes: 'OK to enter any time today.' }),
  ];
}

export const SCHEDULES = [
  { title: 'Quarterly pest control — common areas', property: 'ALD', category: 'Pest control', priority: 'Low', frequency: 'Quarterly', dueInDays: 5, leadDays: 7, vendor: 'Guardian Pest Solutions', assignee: 'luis', estimate: 165, description: 'Exterior perimeter treatment, trash room and basement bait stations.' },
  { title: 'HVAC filter replacement', property: 'ALD', category: 'HVAC', priority: 'Normal', frequency: 'Quarterly', dueInDays: 24, leadDays: 7, vendor: 'Mile High Heating & Air', assignee: 'luis', estimate: 320, description: 'Replace MERV-11 filters in all 16 units and the common-area air handler.' },
  { title: 'Gutter cleaning', property: 'JUN', category: 'Landscaping', priority: 'Low', frequency: 'Semiannually', dueInDays: 10, leadDays: 14, vendor: 'Evergreen Grounds Co.', assignee: 'priya', estimate: 520, description: 'Clean gutters and downspouts on all eight townhomes; check for loose hangers.' },
  { title: 'Fire extinguisher & alarm inspection', property: 'LRK', category: 'Safety', priority: 'High', frequency: 'Annually', dueInDays: 45, leadDays: 21, vendor: 'Brightline Electric', assignee: 'renata', estimate: 450, description: 'Annual inspection and tagging of extinguishers, fire alarm panel test and emergency lighting check (required for the café).' },
  { title: 'Furnace tune-up', property: 'CTW', category: 'HVAC', priority: 'Normal', frequency: 'Annually', dueInDays: 38, leadDays: 14, vendor: 'Mile High Heating & Air', assignee: 'me', estimate: 189, description: 'Pre-winter furnace service, CO test and filter change.' },
];

function rateAreas(areas: InspectionArea[], rand: () => number, issues: Record<string, { condition: 'Fair' | 'Poor' | 'Damaged'; notes: string }> = {}) {
  return areas.map(a => ({
    ...a,
    items: a.items.map(i => {
      const issue = issues[i.id];
      if (issue) return { ...i, condition: issue.condition, notes: issue.notes };
      return { ...i, condition: rand() < 0.12 ? ('Fair' as const) : ('Good' as const), notes: '' };
    }),
  }));
}

export function inspectionPlans(today: string) {
  const rand = prng(4242);
  return [
    { title: 'Move-in inspection — The Alder 201', unit: 'ALD-201', leaseUnitCurrent: true, type: 'Move-in', status: 'Completed', scheduledDaysAgo: 152, overall: 'Excellent', areas: rateAreas(defaultAreas(1, 1), rand), summary: 'Freshly renovated unit, no issues noted. Keys: 2 unit, 1 mailbox, 1 fob.', shared: true, acknowledged: false, inspector: 'luis' },
    { title: 'Move-out inspection — The Alder 304', unit: 'ALD-304', type: 'Move-out', status: 'Completed', scheduledDaysAgo: 13, overall: 'Fair', areas: rateAreas(defaultAreas(1, 1), rand, { 'living.flooring': { condition: 'Poor', notes: 'Carpet heavily soiled by the window; needs professional cleaning.' }, 'bedroom-1.walls-ceiling': { condition: 'Damaged', notes: 'Two anchor holes and a scuff about 18" long above the bed.' } }), summary: 'Normal wear except carpet soiling and bedroom wall damage — deducted $275 from the deposit.', shared: true, acknowledged: false, inspector: 'luis' },
    { title: 'Pre-listing inspection — Larkspur 3B', unit: 'LRK-3B', type: 'Pre-listing', status: 'Completed', scheduledDaysAgo: 40, overall: 'Good', areas: rateAreas(defaultAreas(1, 1), rand), summary: 'Ready to list after cleaning. Replaced two bulbs and the kitchen sink aerator on site.', shared: false, acknowledged: false, inspector: 'renata' },
    { title: 'Routine inspection — Juniper Court B1', unit: 'JUN-B1', type: 'Routine', status: 'In progress', scheduledDaysAgo: 0, overall: null, areas: defaultAreas(2, 1).map((a, i) => (i < 3 ? { ...a, items: a.items.map(it => ({ ...it, condition: 'Good' as const })) } : a)), summary: '', shared: false, acknowledged: false, inspector: 'priya' },
    { title: 'Move-out inspection — The Alder 203', unit: 'ALD-203', type: 'Move-out', status: 'Scheduled', scheduledDaysAgo: -Math.max(1, daysBetween(today, periodEnd(periodOf(today)))), overall: null, areas: defaultAreas(1, 1), summary: '', shared: false, acknowledged: false, inspector: 'luis' },
    { title: 'Annual inspection — 48 Cottonwood Lane', unit: 'CTW-Main', type: 'Annual', status: 'Scheduled', scheduledDaysAgo: -30, overall: null, areas: defaultAreas(4, 2), summary: '', shared: false, acknowledged: false, inspector: 'me' },
  ].map(p => ({ ...p, scheduledFor: `${addDays(today, -p.scheduledDaysAgo)}T${p.status === 'Scheduled' ? '15' : '16'}:00:00.000Z` }));
}

export function listingPlans(today: string) {
  const M0 = periodOf(today);
  return [
    {
      unit: 'ALD-304', slug: 'alder-304-top-floor-studio', title: 'Top-floor studio with mountain views at The Alder', status: 'Published', rent: 1275, deposit: 1275, availableOn: today, views: 184, petPolicy: 'Cats and dogs', leaseTerm: '12 months',
      description: 'Sunny top-floor studio in a renovated 1962 brick building two blocks from City Park. West-facing windows with mountain views, a Murphy bed that frees up the living space, and an updated kitchen with a gas range.\n\nWater, sewer and trash are a flat $65/month. Heat is included. Off-street parking available for $75/month.',
      photos: ['photo-1502672260266-1c1ef2d93688', 'photo-1560448204-e02f11c3d0e2', 'photo-1556911220-bff31c812dba', 'photo-1584622650111-993a426fbf0a'],
      amenities: ['Heat included', 'Mountain views', 'On-site laundry', 'Bike storage', 'Package lockers'],
      showing: 'Self-guided tours available daily 9am–7pm. Request a time and we’ll send a lockbox code.',
    },
    {
      unit: 'LRK-3B', slug: 'larkspur-3b-art-district-loft', title: 'Sunlit industrial loft in the Art District', status: 'Published', rent: 1825, deposit: 1825, availableOn: today, views: 96, petPolicy: 'Cats only', leaseTerm: '12 months',
      description: 'Third-floor loft in a converted 1924 printing building on Santa Fe Drive. Fourteen-foot ceilings, original brick, polished concrete floors and oversized factory windows. Walk to galleries, the light rail and a café downstairs.\n\nShared rooftop deck with city views. Elevator building.',
      photos: ['photo-1536376072261-38c75010e6c9', 'photo-1600210492486-724fe5c67fb0', 'photo-1600566753086-00f18fb6b3ea'],
      amenities: ['14-ft ceilings', 'Rooftop deck', 'Elevator', 'Exposed brick', 'In-unit washer & dryer'],
      showing: 'Showings Tuesday and Thursday evenings, or by appointment with Theo.',
    },
    {
      unit: 'JUN-B3', slug: 'juniper-court-b3-townhome', title: '3-bed townhome with garage — available next month', status: 'Published', rent: 2550, deposit: 2550, availableOn: periodStart(addPeriods(M0, 1)), views: 212, petPolicy: 'Case by case', leaseTerm: '12 months',
      description: 'Spacious two-story townhome with three bedrooms, two and a half baths and an attached one-car garage. Private patio off the kitchen opens onto the shared green. Primary suite with walk-in closet. Washer and dryer included.\n\nCurrent residents move out at the end of the month; the home will be professionally cleaned and repainted before move-in.',
      photos: ['photo-1600596542815-ffad4c1539a9', 'photo-1600585154526-990dced4db0d', 'photo-1600566753190-17f0baa2a6c3', 'photo-1600573472550-8090b5e0745e'],
      amenities: ['Attached garage', 'Private patio', 'Washer & dryer', 'Primary suite', 'Central air'],
      showing: 'Occupied until the end of the month — showings with 24 hours’ notice to residents.',
    },
    {
      unit: 'ALD-102', slug: 'alder-102-garden-level', title: 'Garden-level 1BR steps from City Park', status: 'Draft', rent: 1500, deposit: 1500, availableOn: addDays(today, 14), views: 0, petPolicy: 'Cats and dogs', leaseTerm: '12 months',
      description: 'Quiet garden-level one bedroom with hardwood floors and a walk-in closet. Being freshly painted with new blinds — photos coming soon.',
      photos: ['photo-1522708323590-d24dbb6b0267'],
      amenities: ['Heat included', 'Walk-in closet', 'On-site laundry'],
      showing: 'Available to show once turnover work is complete.',
    },
  ];
}
