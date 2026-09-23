/**
 * The rental application: its shape, its steps and what makes each step
 * complete. Pure TypeScript with no browser or server imports, so the apply
 * page and `submitApplication` enforce exactly the same rules — the page to
 * explain a problem next to the field, the server because the page can be
 * bypassed.
 */

export type CoApplicant = { name: string; email: string; relationship: string; monthlyIncome: number | null; employer: string };
export type Reference = { name: string; relationship: string; phone: string; email: string };
export type EmergencyContact = { name: string; relationship: string; phone: string };

export type ApplicationForm = {
  // About you
  applicantName: string;
  phone: string;
  desiredMoveIn: string;
  occupants: number | null;
  // Residence
  currentAddress: string;
  currentRent: number | null;
  currentLandlord: string;
  landlordPhone: string;
  residenceMonths: number | null;
  reasonForMoving: string;
  priorEviction: boolean | null;
  // Income
  employer: string;
  jobTitle: string;
  employmentMonths: number | null;
  monthlyIncome: number | null;
  // Household
  coApplicants: CoApplicant[];
  hasPets: boolean | null;
  pets: string;
  hasVehicles: boolean | null;
  vehicles: string;
  // References
  references: Reference[];
  emergencyContact: EmergencyContact;
};

export const APPLY_STEPS = [
  { id: 'about', title: 'About you', blurb: 'Who is applying and when you’d like to move in.' },
  { id: 'residence', title: 'Where you live now', blurb: 'Your current home helps us check rental history.' },
  { id: 'income', title: 'Income', blurb: 'Your job and what you earn before taxes.' },
  { id: 'household', title: 'Household', blurb: 'Other adults applying with you, pets and vehicles.' },
  { id: 'references', title: 'References', blurb: 'People who can speak for you, and someone to call in an emergency.' },
  { id: 'review', title: 'Review and sign', blurb: 'Check your answers, then sign and submit.' },
] as const;

export type StepId = (typeof APPLY_STEPS)[number]['id'];
export const CONTENT_STEPS: StepId[] = ['about', 'residence', 'income', 'household', 'references'];

export const LIMITS = { name: 120, email: 254, phone: 40, address: 300, text: 1000, coApplicants: 5, references: 3 };

export const emptyCoApplicant = (): CoApplicant => ({ name: '', email: '', relationship: '', monthlyIncome: null, employer: '' });
export const emptyReference = (): Reference => ({ name: '', relationship: '', phone: '', email: '' });

export function emptyForm(prefill: Partial<ApplicationForm> = {}): ApplicationForm {
  return {
    applicantName: '',
    phone: '',
    desiredMoveIn: '',
    occupants: null,
    currentAddress: '',
    currentRent: null,
    currentLandlord: '',
    landlordPhone: '',
    residenceMonths: null,
    reasonForMoving: '',
    priorEviction: null,
    employer: '',
    jobTitle: '',
    employmentMonths: null,
    monthlyIncome: null,
    coApplicants: [],
    hasPets: null,
    pets: '',
    hasVehicles: null,
    vehicles: '',
    references: [emptyReference()],
    emergencyContact: { name: '', relationship: '', phone: '' },
    ...prefill,
  };
}

// ── Coercion ────────────────────────────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const numOrNull = (v: unknown, max = 100_000_000) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.max(-max, Math.min(max, n));
};
const boolOrNull = (v: unknown) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Anything a browser sent, as a well-typed form: wrong types become blanks, long text is cut, lists are capped. */
export function coerceForm(raw: unknown): ApplicationForm {
  const r = obj(raw);
  const ec = obj(r.emergencyContact);
  const day = text(r.desiredMoveIn, 10);
  return {
    applicantName: text(r.applicantName, LIMITS.name),
    phone: text(r.phone, LIMITS.phone),
    desiredMoveIn: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '',
    occupants: numOrNull(r.occupants, 1000),
    currentAddress: text(r.currentAddress, LIMITS.address),
    currentRent: numOrNull(r.currentRent),
    currentLandlord: text(r.currentLandlord, LIMITS.name),
    landlordPhone: text(r.landlordPhone, LIMITS.phone),
    residenceMonths: numOrNull(r.residenceMonths, 100_000),
    reasonForMoving: text(r.reasonForMoving, LIMITS.text),
    priorEviction: boolOrNull(r.priorEviction),
    employer: text(r.employer, LIMITS.name),
    jobTitle: text(r.jobTitle, LIMITS.name),
    employmentMonths: numOrNull(r.employmentMonths, 100_000),
    monthlyIncome: numOrNull(r.monthlyIncome),
    coApplicants: arr(r.coApplicants).slice(0, LIMITS.coApplicants).map(c => {
      const o = obj(c);
      return { name: text(o.name, LIMITS.name), email: text(o.email, LIMITS.email), relationship: text(o.relationship, LIMITS.name), monthlyIncome: numOrNull(o.monthlyIncome), employer: text(o.employer, LIMITS.name) };
    }),
    hasPets: boolOrNull(r.hasPets),
    pets: text(r.pets, LIMITS.text),
    hasVehicles: boolOrNull(r.hasVehicles),
    vehicles: text(r.vehicles, LIMITS.text),
    references: arr(r.references).slice(0, LIMITS.references).map(x => {
      const o = obj(x);
      return { name: text(o.name, LIMITS.name), relationship: text(o.relationship, LIMITS.name), phone: text(o.phone, LIMITS.phone), email: text(o.email, LIMITS.email) };
    }),
    emergencyContact: { name: text(ec.name, LIMITS.name), relationship: text(ec.relationship, LIMITS.name), phone: text(ec.phone, LIMITS.phone) },
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

export type RuleContext = {
  /** Today as YYYY-MM-DD for the person applying (the server allows a day of slack for time zones). */
  today: string;
  /** The signed-in email the application belongs to. */
  applicantEmail: string;
};

export type Errors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const blank = (s: string | null | undefined) => !s || !s.trim();
export const phoneDigits = (s: string) => s.replace(/\D/g, '');
const validPhone = (s: string) => {
  const d = phoneDigits(s);
  return d.length >= 10 && d.length <= 15;
};

function addDaysTo(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function requirePhone(errors: Errors, key: string, value: string, missing: string) {
  if (blank(value)) errors[key] = missing;
  else if (!validPhone(value)) errors[key] = 'Enter a phone number with area code, like (303) 555-0142.';
}

function months(errors: Errors, key: string, value: number | null, missing: string) {
  if (value == null) errors[key] = missing;
  else if (value < 0 || !Number.isInteger(value)) errors[key] = 'Enter whole years and months.';
  else if (value > 1200) errors[key] = 'That’s longer than we can record — check the years.';
}

function money(errors: Errors, key: string, value: number | null, missing: string) {
  if (value == null) errors[key] = missing;
  else if (value < 0) errors[key] = 'Enter an amount of zero or more.';
  else if (value > 10_000_000) errors[key] = 'That amount looks too large — check it.';
}

export function validateStep(form: ApplicationForm, step: StepId, ctx: RuleContext): Errors {
  const e: Errors = {};
  switch (step) {
    case 'about': {
      const name = form.applicantName.trim();
      if (!name) e.applicantName = 'Enter your full legal name.';
      else if (name.split(/\s+/).length < 2) e.applicantName = 'Enter your first and last name, as they appear on your ID.';
      requirePhone(e, 'phone', form.phone, 'Enter a phone number so we can reach you.');
      if (!form.desiredMoveIn) e.desiredMoveIn = 'Choose the date you’d like to move in.';
      else if (form.desiredMoveIn < addDaysTo(ctx.today, -1)) e.desiredMoveIn = 'Choose a move-in date that’s today or later.';
      else if (form.desiredMoveIn > addDaysTo(ctx.today, 366)) e.desiredMoveIn = 'Choose a date within the next year.';
      if (form.occupants == null) e.occupants = 'Enter how many people will live in the home.';
      else if (!Number.isInteger(form.occupants) || form.occupants < 1) e.occupants = 'Count at least one person — you.';
      else if (form.occupants > 20) e.occupants = 'Enter 20 or fewer people.';
      break;
    }
    case 'residence': {
      if (blank(form.currentAddress)) e.currentAddress = 'Enter your current street address, city and state.';
      money(e, 'currentRent', form.currentRent, 'Enter your monthly rent, or 0 if you don’t pay rent.');
      const rents = (form.currentRent ?? 0) > 0;
      if (rents && blank(form.currentLandlord)) e.currentLandlord = 'Enter your landlord or property manager’s name.';
      if (rents || !blank(form.landlordPhone)) requirePhone(e, 'landlordPhone', form.landlordPhone, 'Enter a phone number for your landlord.');
      months(e, 'residenceMonths', form.residenceMonths, 'Tell us how long you’ve lived there.');
      if (blank(form.reasonForMoving)) e.reasonForMoving = 'Tell us briefly why you’re moving.';
      if (form.priorEviction == null) e.priorEviction = 'Choose yes or no.';
      break;
    }
    case 'income': {
      if (blank(form.employer)) e.employer = 'Enter your employer, or “Self-employed”, “Retired” or “Student”.';
      if (blank(form.jobTitle)) e.jobTitle = 'Enter your job title or role.';
      months(e, 'employmentMonths', form.employmentMonths, 'Tell us how long you’ve worked there.');
      money(e, 'monthlyIncome', form.monthlyIncome, 'Enter your gross monthly income, before taxes.');
      break;
    }
    case 'household': {
      const emails = new Set<string>();
      form.coApplicants.forEach((c, i) => {
        const k = `coApplicants.${i}`;
        if (blank(c.name)) e[`${k}.name`] = 'Enter their full name.';
        const email = c.email.trim().toLowerCase();
        if (!email) e[`${k}.email`] = 'Enter their email address.';
        else if (!EMAIL_RE.test(email)) e[`${k}.email`] = 'Enter a valid email address.';
        else if (email === ctx.applicantEmail.toLowerCase()) e[`${k}.email`] = 'Use their own email, not yours.';
        else if (emails.has(email)) e[`${k}.email`] = 'Each co-applicant needs a different email.';
        emails.add(email);
        if (blank(c.relationship)) e[`${k}.relationship`] = 'Enter how they’re related to you.';
        if (c.monthlyIncome != null && (c.monthlyIncome < 0 || c.monthlyIncome > 10_000_000)) e[`${k}.monthlyIncome`] = 'Enter an amount of zero or more.';
      });
      if (form.hasPets == null) e.hasPets = 'Choose yes or no.';
      else if (form.hasPets && blank(form.pets)) e.pets = 'Describe each pet: type, breed and weight.';
      if (form.hasVehicles == null) e.hasVehicles = 'Choose yes or no.';
      else if (form.hasVehicles && blank(form.vehicles)) e.vehicles = 'Enter the year, make and model of each vehicle.';
      break;
    }
    case 'references': {
      if (form.references.length === 0) e.references = 'Add at least one reference.';
      form.references.forEach((r, i) => {
        const k = `references.${i}`;
        if (blank(r.name)) e[`${k}.name`] = 'Enter their name.';
        if (blank(r.relationship)) e[`${k}.relationship`] = 'Enter how you know them.';
        requirePhone(e, `${k}.phone`, r.phone, 'Enter their phone number.');
        if (!blank(r.email) && !EMAIL_RE.test(r.email.trim())) e[`${k}.email`] = 'Enter a valid email address, or leave it blank.';
      });
      if (blank(form.emergencyContact.name)) e['emergencyContact.name'] = 'Enter someone we can call in an emergency.';
      requirePhone(e, 'emergencyContact.phone', form.emergencyContact.phone, 'Enter their phone number.');
      break;
    }
    case 'review':
      break;
  }
  return e;
}

export function validateAll(form: ApplicationForm, ctx: RuleContext): Errors {
  return Object.assign({}, ...CONTENT_STEPS.map(s => validateStep(form, s, ctx)));
}

export function firstInvalidStep(form: ApplicationForm, ctx: RuleContext): StepId | null {
  return CONTENT_STEPS.find(s => Object.keys(validateStep(form, s, ctx)).length > 0) ?? null;
}

export function completedSteps(form: ApplicationForm, ctx: RuleContext) {
  return CONTENT_STEPS.filter(s => Object.keys(validateStep(form, s, ctx)).length === 0).length;
}

/** Whether a step has anything typed into it, so an untouched step isn't marked "needs attention". */
export function stepTouched(form: ApplicationForm, step: StepId) {
  switch (step) {
    case 'about':
      return Boolean(form.phone || form.desiredMoveIn || form.occupants != null);
    case 'residence':
      return Boolean(form.currentAddress || form.currentRent != null || form.currentLandlord || form.residenceMonths != null || form.reasonForMoving || form.priorEviction != null);
    case 'income':
      return Boolean(form.employer || form.jobTitle || form.employmentMonths != null || form.monthlyIncome != null);
    case 'household':
      return form.coApplicants.length > 0 || form.hasPets != null || form.hasVehicles != null;
    case 'references':
      return form.references.some(r => r.name || r.phone) || Boolean(form.emergencyContact.name || form.emergencyContact.phone);
    default:
      return false;
  }
}

/** Household income before taxes: the applicant plus every co-applicant. */
export function householdIncome(form: Pick<ApplicationForm, 'monthlyIncome' | 'coApplicants'>) {
  const cents = Math.round((form.monthlyIncome ?? 0) * 100) + form.coApplicants.reduce((a, c) => a + Math.round((c.monthlyIncome ?? 0) * 100), 0);
  return cents / 100;
}

/** A signature matches when it's the applicant's name, ignoring case, spacing and punctuation. */
export function signatureMatches(signature: string, legalName: string) {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(signature).length > 0 && norm(signature) === norm(legalName);
}

/** Months as "2 years, 3 months". */
export function durationLabel(total: number | null | undefined) {
  if (total == null) return '';
  const y = Math.floor(total / 12);
  const m = total % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} ${y === 1 ? 'year' : 'years'}`);
  if (m || !y) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  return parts.join(', ');
}
