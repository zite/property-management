import { addDays, periodLabel, periodOf, addPeriods, periodStart } from '@project/shared/dates';
import { SCREENING_CHECKS } from '@project/shared/constants';
import { SAMPLE_PDF } from './model';

/**
 * The people side of the demo: conversations, applications, inquiries,
 * announcements, documents, tasks and an inbox that reads like a real Monday.
 * Timestamps are offsets from now; `at(days, hour)` is local-ish UTC.
 */

export const at = (today: string, daysAgo: number, hour = 15, minute = 0) => `${addDays(today, -daysAgo)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

export type ThreadMessage = { daysAgo: number; hour: number; direction: 'Inbound' | 'Outbound' | 'Internal'; channel: 'Email' | 'Portal' | 'Note'; from?: 'renata' | 'priya' | 'theo' | 'grace' | 'luis' | 'me'; subject: string; body: string; read?: boolean };

/** Conversations with residents, keyed by lease unit. */
export const TENANT_THREADS: Array<{ unit: string; messages: ThreadMessage[] }> = [
  {
    unit: 'ALD-201',
    messages: [
      { daysAgo: 150, hour: 16, direction: 'Outbound', channel: 'Email', from: 'renata', subject: 'Welcome to The Alder', body: 'Welcome home! Your keys, mailbox key and fob are in the office lockbox (code 4821). Trash pickup is Tuesday mornings and the laundry room is in the basement by the bike storage.\n\nPay rent and request maintenance any time in the resident portal.' },
      { daysAgo: 9, hour: 19, direction: 'Inbound', channel: 'Portal', subject: 'Parking space question', body: 'Hi! Is there any chance I could switch to a parking space closer to the entrance? #14 is at the far end of the lot. Happy to pay the same.', read: true },
      { daysAgo: 8, hour: 15, direction: 'Outbound', channel: 'Portal', from: 'renata', subject: 'Re: Parking space question', body: 'Hi — space #6 opens up at the end of the month when the Goldbergs move out. I’ve put you first on the list and will switch it over then. Same price.' },
    ],
  },
  {
    unit: 'JUN-B2',
    messages: [
      { daysAgo: 38, hour: 17, direction: 'Outbound', channel: 'Email', from: 'priya', subject: 'Checking in about your balance', body: 'Hi Laura, I noticed rent for last month is still outstanding. I know things come up — can we set up a quick call this week to talk about a plan that works?' },
      { daysAgo: 36, hour: 23, direction: 'Inbound', channel: 'Email', subject: 'Re: Checking in about your balance', body: 'Hi Priya, sorry for the delay. My hours got cut this summer. I can pay $2,200 on the 20th and the rest in two installments. Would that be OK?', read: true },
      { daysAgo: 35, hour: 16, direction: 'Outbound', channel: 'Email', from: 'priya', subject: 'Re: Checking in about your balance', body: 'Thank you for letting me know. Yes — $2,200 on the 20th, then we’ll split the rest over the next two months. I’ll note it on your account so late fees are on hold while you stick to the plan.' },
      { daysAgo: 1, hour: 14, direction: 'Inbound', channel: 'Portal', subject: 'This month', body: 'Hi Priya — I get paid Friday and will pay this month’s rent then. Thank you for working with me.', read: false },
    ],
  },
  {
    unit: 'SAB-Lower',
    messages: [
      { daysAgo: 6, hour: 16, direction: 'Outbound', channel: 'Email', from: 'priya', subject: 'Your renewal offer for 1714 S Pearl St, Lower', body: 'Hi Fatima, we’d love for you to stay. Your renewal offer is $1,715/month for 12 months. Please accept or decline in the portal by the date shown.' },
      { daysAgo: 2, hour: 20, direction: 'Inbound', channel: 'Portal', subject: 'Re: Renewal', body: 'Thanks Priya! Before I sign — would you consider $1,690 if I sign for 18 months instead? I really like it here.', read: false },
    ],
  },
  {
    unit: 'ALD-203',
    messages: [
      { daysAgo: 12, hour: 18, direction: 'Inbound', channel: 'Portal', subject: 'Notice to vacate', body: 'Hi Renata, we closed on a house in Arvada! Please accept this as our 30-day notice. Our last day will be the date on the notice. Where should we leave the keys?', read: true },
      { daysAgo: 11, hour: 15, direction: 'Outbound', channel: 'Email', from: 'renata', subject: 'Re: Notice to vacate', body: 'Congratulations! I’ve recorded your move-out date. We’ll schedule a move-out inspection for your last day — you’re welcome to be there. Leave all keys and fobs in the office drop box.' },
    ],
  },
  {
    unit: 'LRK-1A',
    messages: [
      { daysAgo: 4, hour: 13, direction: 'Inbound', channel: 'Email', subject: 'Rooftop unit is loud again', body: 'Hi — the HVAC above the café is grinding again every morning at startup. Customers are noticing. Can someone take a look before the weekend?', read: true },
      { daysAgo: 4, hour: 15, direction: 'Outbound', channel: 'Email', from: 'renata', subject: 'Re: Rooftop unit is loud again', body: 'Thanks Elena — Mile High Heating & Air will be out tomorrow morning at 7. I’ve opened a work order and will keep you posted.' },
    ],
  },
  {
    unit: 'ALD-302',
    messages: [
      { daysAgo: 3, hour: 21, direction: 'Inbound', channel: 'Portal', subject: 'Late fee question', body: 'Can the late fee this month be waived? My direct deposit came a day late. I paid most of the rent already.', read: false },
    ],
  },
  {
    unit: 'JUN-B3',
    messages: [
      { daysAgo: 40, hour: 17, direction: 'Inbound', channel: 'Email', subject: 'Moving out', body: 'Hi Priya, we’re relocating to Austin for work and will move out at the end of next month. Consider this our notice.', read: true },
      { daysAgo: 39, hour: 16, direction: 'Outbound', channel: 'Email', from: 'priya', subject: 'Re: Moving out', body: 'Thanks for letting us know, Chris and Dana. We’ll be showing the townhome with 24 hours’ notice. We’ll send move-out instructions two weeks before your last day.' },
    ],
  },
];

export const OWNER_THREADS: Array<{ owner: 'ridgeview' | 'hollis' | 'shah' | 'me'; messages: ThreadMessage[] }> = [
  {
    owner: 'shah',
    messages: [
      { daysAgo: 5, hour: 17, direction: 'Outbound', channel: 'Email', from: 'me', subject: 'Approval needed: water heater at Elm Street', body: 'Hi Anika, during a routine visit we found the water heater at 2217 Elm is from 2008 with rust at the base and a slow drip. Front Range Plumbing quoted $1,850 to replace it with a 50-gal unit. I’d recommend doing it before winter — approve or decline in your owner portal.' },
      { daysAgo: 4, hour: 2, direction: 'Inbound', channel: 'Email', subject: 'Re: Approval needed: water heater at Elm Street', body: 'Thanks. Could you get a second quote? $1,850 seems high. If it’s within $200 go ahead.', read: false },
    ],
  },
  {
    owner: 'ridgeview',
    messages: [
      { daysAgo: 20, hour: 16, direction: 'Outbound', channel: 'Email', from: 'renata', subject: 'Q3 update: The Alder and Larkspur Lofts', body: 'Hi Alan, quick quarterly update: occupancy is 88% at The Alder with 304 and 102 turning over, and Larkspur 3B is listed. The smoke detector replacement at The Alder is complete. No major capital items expected before year-end.' },
      { daysAgo: 19, hour: 22, direction: 'Inbound', channel: 'Email', subject: 'Re: Q3 update', body: 'Thanks Renata. Please send the Larkspur roof warranty paperwork when you have it.', read: true },
    ],
  },
  {
    owner: 'me',
    messages: [
      { daysAgo: 60, hour: 16, direction: 'Outbound', channel: 'Email', from: 'grace', subject: 'Your owner portal is ready', body: 'Your owner statements, distributions and property documents are now available in the owner portal. Statements post by the 10th of each month.' },
    ],
  },
];

export const VENDOR_THREADS: Array<{ vendor: string; messages: ThreadMessage[] }> = [
  {
    vendor: 'Mile High Heating & Air',
    messages: [
      { daysAgo: 16, hour: 15, direction: 'Outbound', channel: 'Email', from: 'luis', subject: 'Certificate of insurance expiring', body: 'Hi Sandra — our records show your certificate of insurance expires soon. Please send the renewed certificate so we can keep assigning work.' },
    ],
  },
  {
    vendor: 'Spotless Turnover Cleaning',
    messages: [
      { daysAgo: 10, hour: 18, direction: 'Outbound', channel: 'Email', from: 'grace', subject: 'W-9 needed', body: 'Hi Amara, we don’t have a W-9 on file for Spotless. Could you upload one in the vendor portal before year-end so we can issue your 1099?' },
    ],
  },
];

/** Comments on work orders, keyed by work order number offset from the first open one. */
export const WORK_ORDER_COMMENTS: Array<{ title: string; messages: Array<ThreadMessage & { to?: 'tenant' | 'vendor' | null }> }> = [
  {
    title: 'No heat — thermostat blank',
    messages: [
      { daysAgo: 0, hour: 13, direction: 'Inbound', channel: 'Portal', subject: 'Photo', body: 'Here’s the thermostat — completely blank. I tried new batteries.', read: false, to: 'tenant' },
    ],
  },
  {
    title: 'Water stain spreading on bathroom ceiling',
    messages: [
      { daysAgo: 2, hour: 17, direction: 'Internal', channel: 'Note', from: 'luis', subject: 'Note', body: 'Checked 401 — no visible leak at the tub. Likely the drain gasket. Scheduled Front Range for tomorrow 9am; they’ll open the ceiling in 301 if needed.' },
      { daysAgo: 2, hour: 17, direction: 'Outbound', channel: 'Portal', from: 'luis', subject: 'Scheduled', body: 'Hi Liam — a plumber from Front Range Plumbing will be there tomorrow at 9am. They may need to cut a small access hole in the ceiling; we’ll patch it after.', to: 'tenant' },
    ],
  },
  {
    title: 'Replace water heater (18 years old, rusting at base)',
    messages: [
      { daysAgo: 5, hour: 16, direction: 'Internal', channel: 'Note', from: 'me', subject: 'Note', body: 'Quote from Front Range: $1,850 installed (50-gal, 9-yr warranty, haul away). Over the $500 threshold — sent to the owner for approval.' },
      { daysAgo: 4, hour: 15, direction: 'Internal', channel: 'Note', from: 'me', subject: 'Note', body: 'Owner wants a second quote. Asked Summit for one — they said they can do $1,640 but not until next Thursday.' },
    ],
  },
  {
    title: 'Turnover: paint, carpet clean, new blinds — 102',
    messages: [
      { daysAgo: 3, hour: 22, direction: 'Inbound', channel: 'Email', subject: 'Progress', body: 'Paint is done in the living room and bedroom. Starting trim tomorrow. Carpet cleaners booked for Friday.', read: true, to: 'vendor' },
      { daysAgo: 2, hour: 15, direction: 'Internal', channel: 'Note', from: 'theo', subject: 'Note', body: '@[Luis Fernández](luis) can we have this done by the 28th? I have two people asking to see it.' },
    ],
  },
  {
    title: 'Retail HVAC making grinding noise',
    messages: [
      { daysAgo: 1, hour: 20, direction: 'Inbound', channel: 'Email', subject: 'Diagnosis', body: 'Blower motor bearings are failing. We have the motor on order, arrives tomorrow. Estimate $780 including labor. Unit is safe to run in the meantime.', read: true, to: 'vendor' },
    ],
  },
];

export const ANNOUNCEMENTS = (today: string) => [
  { title: 'Water shut-off Thursday, 9am–1pm', body: 'Front Range Plumbing will be replacing a main valve in the basement. Water will be off for the whole building on Thursday from 9am to about 1pm. Please plan ahead — we’ll send an update if it finishes early.', audience: 'Selected properties', properties: ['ALD'], channel: 'Email and portal', status: 'Sent', sentDaysAgo: 2, recipients: 18, pinnedUntil: addDays(today, 3) },
  { title: 'Office closed Monday for the holiday', body: 'Our office will be closed on Monday. For maintenance emergencies — no heat, flooding, gas smell, no power — call (303) 555-0199 any time. Rent payments in the portal are processed as normal.', audience: 'All residents', properties: [], channel: 'Email and portal', status: 'Sent', sentDaysAgo: 11, recipients: 44, pinnedUntil: null },
  { title: 'Owner statements now in the portal', body: 'Monthly owner statements, distribution history and property documents are now available in your owner portal. Statements post by the 10th of each month. Reply to this email with any questions.', audience: 'Owners', properties: [], channel: 'Email and portal', status: 'Sent', sentDaysAgo: 60, recipients: 4, pinnedUntil: null },
  { title: 'Fall reminder: change your furnace filter', body: 'Heating season is almost here. If your home has a furnace filter you replace yourself, now is a great time. Need filters? Request them in the portal and we’ll drop some off.', audience: 'All residents', properties: [], channel: 'Portal only', status: 'Draft', sentDaysAgo: null, recipients: 0, pinnedUntil: null },
];

export const INQUIRIES = (today: string) => [
  { name: 'Olivia Park', email: 'olivia.park@example.com', phone: '(720) 555-0102', listing: 'alder-304-top-floor-studio', status: 'Applied', source: 'Listing site', daysAgo: 9, showingDaysAgo: 7, desiredMoveIn: addDays(today, 16), assignee: 'theo', message: 'Is heat included? I work downtown and would love to walk to City Park.', notes: 'Toured Tuesday, loved the light. Applied the same night.' },
  { name: 'Diego Morales', email: 'diego.morales@example.com', phone: '(303) 555-0103', listing: 'alder-304-top-floor-studio', status: 'Applied', source: 'Portal', daysAgo: 6, showingDaysAgo: 5, desiredMoveIn: addDays(today, 20), assignee: 'theo', message: 'Do you allow a small dog? She’s 18 lb.', notes: '' },
  { name: 'Marcus Johnson', email: 'marcus.johnson@example.com', phone: '(720) 555-0104', listing: 'larkspur-3b-art-district-loft', status: 'Applied', source: 'Portal', daysAgo: 3, showingDaysAgo: 2, desiredMoveIn: periodStart(addPeriods(periodOf(today), 1)), assignee: 'theo', message: 'My partner and I are both artists — is the loft OK for a small home studio (no kilns)?', notes: '' },
  { name: 'Hannah Lee', email: 'hannah.lee@example.com', phone: '(303) 555-0105', listing: 'juniper-court-b3-townhome', status: 'Closed', source: 'Listing site', daysAgo: 30, showingDaysAgo: 26, desiredMoveIn: addDays(today, 10), assignee: 'theo', message: 'Looking for a 3-bed near Cherry Creek schools.', notes: 'Withdrew her application — found a place closer to work.' },
  { name: 'Kai Anderson', email: 'kai.anderson@example.com', phone: '(720) 555-0106', listing: 'larkspur-3b-art-district-loft', status: 'Showing scheduled', source: 'Portal', daysAgo: 2, showingDaysAgo: -2, desiredMoveIn: addDays(today, 45), assignee: 'theo', message: 'Can I see it Thursday evening?', notes: '' },
  { name: 'Brianna Scott', email: 'brianna.scott@example.com', phone: '(303) 555-0107', listing: 'alder-304-top-floor-studio', status: 'Showing scheduled', source: 'Phone', daysAgo: 1, showingDaysAgo: -1, desiredMoveIn: addDays(today, 30), assignee: 'theo', message: 'Called the office — wants a Saturday showing.', notes: '' },
  { name: 'Rafael Costa', email: 'rafael.costa@example.com', phone: '(720) 555-0108', listing: 'juniper-court-b3-townhome', status: 'Contacted', source: 'Listing site', daysAgo: 4, showingDaysAgo: null, desiredMoveIn: periodStart(addPeriods(periodOf(today), 2)), assignee: 'theo', message: 'Is the garage big enough for a pickup truck?', notes: 'Left voicemail; sent garage dimensions by email.' },
  { name: 'Emily Watson', email: 'emily.watson@example.com', phone: '(303) 555-0109', listing: 'larkspur-3b-art-district-loft', status: 'New', source: 'Portal', daysAgo: 0, showingDaysAgo: null, desiredMoveIn: addDays(today, 21), assignee: null, message: 'Hi! Is the rooftop deck shared with the café? And is there bike storage?', notes: '' },
  { name: 'Jamal Wright', email: 'jamal.wright@example.com', phone: '(720) 555-0110', listing: 'alder-304-top-floor-studio', status: 'New', source: 'Listing site', daysAgo: 0, showingDaysAgo: null, desiredMoveIn: addDays(today, 14), assignee: null, message: 'Still available? I can move in right away.', notes: '' },
  { name: 'Lena Fischer', email: 'lena.fischer@example.com', phone: '(303) 555-0111', listing: 'juniper-court-b3-townhome', status: 'New', source: 'Email', daysAgo: 1, showingDaysAgo: null, desiredMoveIn: periodStart(addPeriods(periodOf(today), 1)), assignee: null, message: 'We have two kids and a cat. Is the green fenced?', notes: '' },
];

type Check = { key: string; result: 'Pending' | 'Pass' | 'Concern' | 'Fail' | 'Waived'; note?: string };
const screening = (results: Record<string, Check['result']>, notes: Record<string, string> = {}) =>
  SCREENING_CHECKS.map(c => ({ key: c.key, label: c.label, result: results[c.key] ?? 'Pending', note: notes[c.key] ?? '' }));

export const APPLICATIONS = (today: string) => [
  {
    number: 201, applicantName: 'Sam Rivera', email: 'sam.rivera@example.com', phone: '(720) 555-0120', listing: 'juniper-court-b3-townhome', unit: 'JUN-B3', status: 'Approved', source: 'Listing site', submittedDaysAgo: 19, decidedDaysAgo: 14,
    desiredMoveIn: periodStart(addPeriods(periodOf(today), 1)), monthlyIncome: 9200, employer: 'Aurora Public Schools', jobTitle: 'Middle school teacher', employmentMonths: 74, currentAddress: '1244 S Joliet Way, Aurora, CO 80012', currentRent: 2100, currentLandlord: 'Parkside Apartments', landlordPhone: '(303) 555-0190', residenceMonths: 38, reasonForMoving: 'Need a third bedroom for our growing family', occupants: 4, pets: 'None', vehicles: '2019 Toyota Sienna',
    coApplicants: [{ name: 'Jess Rivera', email: 'jess.rivera@example.com', relationship: 'Spouse', monthlyIncome: 4100, employer: 'Self-employed (graphic design)' }],
    screening: screening({ identity: 'Pass', income: 'Pass', employment: 'Pass', rental_history: 'Pass', credit: 'Pass', background: 'Pass' }, { rental_history: 'Parkside confirmed on-time payments for 3 years.' }),
    screeningNotes: 'Household income $13,300/mo = 5.2× rent. Strong references.', decisionReason: 'Meets all screening criteria.', decidedBy: 'theo', assignee: 'theo', feePaidDaysAgo: 19,
  },
  {
    number: 202, applicantName: 'Olivia Park', email: 'olivia.park@example.com', phone: '(720) 555-0102', listing: 'alder-304-top-floor-studio', unit: 'ALD-304', status: 'Screening', source: 'Listing site', submittedDaysAgo: 7, decidedDaysAgo: null,
    desiredMoveIn: addDays(today, 16), monthlyIncome: 5200, employer: 'Ridgeline Health', jobTitle: 'Physical therapy assistant', employmentMonths: 26, currentAddress: '880 Pearl St #12, Denver, CO 80203', currentRent: 1150, currentLandlord: 'Pearl Street Rentals', landlordPhone: '(303) 555-0191', residenceMonths: 24, reasonForMoving: 'Closer to work', occupants: 1, pets: 'None', vehicles: '',
    coApplicants: [], screening: screening({ identity: 'Pass', income: 'Pass', employment: 'Pass' }), screeningNotes: 'Income 4.1× rent. Waiting on landlord reference call-back.', decisionReason: '', decidedBy: null, assignee: 'theo', feePaidDaysAgo: 7,
  },
  {
    number: 203, applicantName: 'Diego Morales', email: 'diego.morales@example.com', phone: '(303) 555-0103', listing: 'alder-304-top-floor-studio', unit: 'ALD-304', status: 'Screening', source: 'Portal', submittedDaysAgo: 5, decidedDaysAgo: null,
    desiredMoveIn: addDays(today, 20), monthlyIncome: 3600, employer: 'Blue Door Bakery', jobTitle: 'Shift lead', employmentMonths: 14, currentAddress: '3301 W 38th Ave, Denver, CO 80211', currentRent: 1050, currentLandlord: 'Private landlord (J. Ellis)', landlordPhone: '(720) 555-0192', residenceMonths: 18, reasonForMoving: 'Current building is being sold', occupants: 1, pets: 'Dog (Pepper, 18 lb)', vehicles: '2015 Honda Fit',
    coApplicants: [], screening: screening({ identity: 'Pass', income: 'Concern', employment: 'Pass' }, { income: '2.8× rent — below 3× guideline. Asked about savings or a guarantor.' }), screeningNotes: '', decisionReason: '', decidedBy: null, assignee: 'theo', feePaidDaysAgo: 5,
  },
  {
    number: 204, applicantName: 'Marcus Johnson', email: 'marcus.johnson@example.com', phone: '(720) 555-0104', listing: 'larkspur-3b-art-district-loft', unit: 'LRK-3B', status: 'Submitted', source: 'Portal', submittedDaysAgo: 0, decidedDaysAgo: null,
    desiredMoveIn: periodStart(addPeriods(periodOf(today), 1)), monthlyIncome: 4800, employer: 'Freelance illustrator', jobTitle: 'Illustrator', employmentMonths: 60, currentAddress: '44 Galapago St, Denver, CO 80223', currentRent: 1400, currentLandlord: 'Santa Fe Lofts LLC', landlordPhone: '(303) 555-0193', residenceMonths: 30, reasonForMoving: 'Want more natural light for studio work', occupants: 2, pets: 'Cat', vehicles: '',
    coApplicants: [{ name: 'Tia Johnson', email: 'tia.johnson@example.com', relationship: 'Partner', monthlyIncome: 3900, employer: 'Denver Art Museum' }], screening: screening({}), screeningNotes: '', decisionReason: '', decidedBy: null, assignee: null, feePaidDaysAgo: 0,
  },
  {
    number: 205, applicantName: 'Ethan Brooks', email: 'ethan.brooks@example.com', phone: '(303) 555-0112', listing: 'larkspur-3b-art-district-loft', unit: 'LRK-3B', status: 'Denied', source: 'Listing site', submittedDaysAgo: 16, decidedDaysAgo: 11,
    desiredMoveIn: addDays(today, -5), monthlyIncome: 3400, employer: 'Rideshare driver', jobTitle: 'Driver', employmentMonths: 5, currentAddress: '2200 Stout St, Denver, CO 80205', currentRent: 1300, currentLandlord: 'Stout Street Flats', landlordPhone: '(303) 555-0194', residenceMonths: 7, reasonForMoving: 'Lease ending', occupants: 1, pets: 'None', vehicles: '2020 Hyundai Elantra',
    coApplicants: [], screening: screening({ identity: 'Pass', income: 'Fail', employment: 'Concern', rental_history: 'Pass', credit: 'Concern', background: 'Pass' }, { income: '1.9× rent; no guarantor offered.' }), screeningNotes: 'Offered option to add a guarantor; applicant declined.', decisionReason: 'Income below the 3× rent requirement and no guarantor.', decidedBy: 'theo', assignee: 'theo', feePaidDaysAgo: 16,
  },
  {
    number: 206, applicantName: 'Hannah Lee', email: 'hannah.lee@example.com', phone: '(303) 555-0105', listing: 'juniper-court-b3-townhome', unit: 'JUN-B3', status: 'Withdrawn', source: 'Listing site', submittedDaysAgo: 25, decidedDaysAgo: 21,
    desiredMoveIn: addDays(today, 10), monthlyIncome: 11000, employer: 'Lockheed Martin', jobTitle: 'Systems engineer', employmentMonths: 48, currentAddress: '9800 E Colorado Ave, Denver, CO 80247', currentRent: 2300, currentLandlord: 'Highline Crossing', landlordPhone: '(303) 555-0195', residenceMonths: 20, reasonForMoving: 'Relocating for schools', occupants: 3, pets: 'None', vehicles: '',
    coApplicants: [], screening: screening({ identity: 'Pass', income: 'Pass' }), screeningNotes: '', decisionReason: 'Applicant withdrew — signed elsewhere.', decidedBy: null, assignee: 'theo', feePaidDaysAgo: 25,
  },
];

export const TASKS = (today: string) => [
  { title: 'Get a second water heater quote for Elm Street', description: 'Owner asked for a second quote before approving the $1,850 replacement.', status: 'In progress', priority: 'High', category: 'Maintenance', dueIn: 2, assignee: 'me', unit: 'ELM-Main' },
  { title: 'Review and send owner statements', description: 'Check last month’s statements for all four owners before they post on the 10th.', status: 'To do', priority: 'Normal', category: 'Accounting', dueIn: 3, assignee: 'me', unit: null },
  { title: 'Settle security deposit — Megan Holt (Alder 102)', description: 'Move-out inspection had no deductions. Refund must be mailed within 30 days of move-out.', status: 'To do', priority: 'High', category: 'Move-out', dueIn: 6, assignee: 'renata', unit: 'ALD-102' },
  { title: 'Respond to Fatima’s renewal counter-offer', description: 'She asked for $1,690 on an 18-month term. Check with Hollis Trust.', status: 'To do', priority: 'Normal', category: 'Renewal', dueIn: 1, assignee: 'priya', unit: 'SAB-Lower' },
  { title: 'Payment plan follow-up — Laura Bennett', description: 'Second installment due Friday. Confirm and keep late fees on hold if paid.', status: 'To do', priority: 'Normal', category: 'Accounting', dueIn: 4, assignee: 'priya', unit: 'JUN-B2' },
  { title: 'Collect updated COI from Brightline Electric', description: 'Certificate of insurance expired. Don’t assign new work until received.', status: 'To do', priority: 'Urgent', category: 'Compliance', dueIn: -1, assignee: 'luis', unit: null, vendor: 'Brightline Electric' },
  { title: 'Photograph Alder 102 for the listing', description: 'After paint and blinds are done — include the courtyard and laundry room.', status: 'To do', priority: 'Normal', category: 'Leasing', dueIn: 9, assignee: 'theo', unit: 'ALD-102' },
  { title: 'Send lease to Sam & Jess Rivera', description: 'Application approved. Generate the lease for Juniper B3 and send for signature.', status: 'Done', priority: 'High', category: 'Leasing', dueIn: -12, assignee: 'theo', unit: 'JUN-B3', completedDaysAgo: 12 },
  { title: 'Reconcile operating account', description: 'Last month’s bank statement arrived. Mark cleared items and complete the reconciliation.', status: 'To do', priority: 'Normal', category: 'Accounting', dueIn: 5, assignee: 'grace', unit: null },
  { title: 'Order replacement screen for Alder 204', description: 'Custom size 34 1/8" × 46 3/4".', status: 'Done', priority: 'Low', category: 'Maintenance', dueIn: -6, assignee: 'luis', unit: 'ALD-204', completedDaysAgo: 7 },
];

export const DOCUMENTS = (today: string) => [
  { name: 'Signed lease — Alder 201.pdf', category: 'Lease', lease: 'ALD-201', sharedWithTenant: true, daysAgo: 152 },
  { name: 'Renters insurance — Alder 201.pdf', category: 'Insurance', lease: 'ALD-201', sharedWithTenant: true, daysAgo: 150, expiresIn: 213 },
  { name: 'Signed lease — Juniper A2.pdf', category: 'Lease', lease: 'JUN-A2', sharedWithTenant: true, daysAgo: 95 },
  { name: 'Signed lease — Larkspur 1A (commercial).pdf', category: 'Lease', lease: 'LRK-1A', sharedWithTenant: true, daysAgo: 610 },
  { name: 'Notice to vacate — Goldberg.pdf', category: 'Notice', lease: 'ALD-203', sharedWithTenant: true, daysAgo: 12 },
  { name: 'Payment plan agreement — Bennett.pdf', category: 'Addendum', lease: 'JUN-B2', sharedWithTenant: true, daysAgo: 35 },
  { name: 'Pet addendum — Carter.pdf', category: 'Addendum', lease: 'ALD-303', sharedWithTenant: true, daysAgo: 180 },
  { name: 'Management agreement — Ridgeview Holdings.pdf', category: 'Other', owner: 'ridgeview', sharedWithOwner: true, daysAgo: 400 },
  { name: 'Management agreement — Hollis Family Trust.pdf', category: 'Other', owner: 'hollis', sharedWithOwner: true, daysAgo: 900 },
  { name: 'Management agreement — 48 Cottonwood Lane.pdf', category: 'Other', owner: 'me', sharedWithOwner: true, daysAgo: 300 },
  { name: 'Roof warranty — Larkspur Lofts.pdf', category: 'Other', property: 'LRK', sharedWithOwner: true, daysAgo: 140 },
  { name: 'Property insurance policy — The Alder.pdf', category: 'Insurance', property: 'ALD', sharedWithOwner: true, daysAgo: 250, expiresIn: 115 },
  { name: 'Certificate of insurance — Front Range Plumbing.pdf', category: 'Insurance', vendor: 'Front Range Plumbing & Drain', daysAgo: 155, expiresIn: 210 },
  { name: 'Certificate of insurance — Mile High Heating & Air.pdf', category: 'Insurance', vendor: 'Mile High Heating & Air', daysAgo: 349, expiresIn: 16 },
  { name: 'Certificate of insurance — Brightline Electric.pdf', category: 'Insurance', vendor: 'Brightline Electric', daysAgo: 369, expiresIn: -4 },
  { name: 'W-9 — Front Range Plumbing.pdf', category: 'Other', vendor: 'Front Range Plumbing & Drain', daysAgo: 400 },
  { name: 'Water heater quote — Front Range.pdf', category: 'Invoice', workOrder: 'Replace water heater (18 years old, rusting at base)', sharedWithOwner: true, daysAgo: 5 },
  { name: 'Move-out inspection report — Alder 304.pdf', category: 'Inspection', unit: 'ALD-304', daysAgo: 13 },
].map(d => ({ ...d, url: `${SAMPLE_PDF}?name=${encodeURIComponent(d.name)}` }));

export const SAVED_VIEWS = [
  { name: 'Emergencies & high priority', scope: 'work_orders', config: { filters: { priorities: ['Emergency', 'High'], statuses: ['New', 'Scheduled', 'In progress', 'On hold'] }, options: { layout: 'list', grouping: 'status' } }, shared: true },
  { name: 'Waiting on owner approval', scope: 'work_orders', config: { filters: { approvals: ['Pending'] }, options: { layout: 'list', grouping: 'property' } }, shared: true },
  { name: 'Leases ending in 90 days', scope: 'leases', config: { filters: { phases: ['Expiring', 'Notice'] }, options: { grouping: 'property' } }, shared: true },
];

export function periodName(today: string, offset: number) {
  return periodLabel(addPeriods(periodOf(today), offset));
}
