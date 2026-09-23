import { CircleCheck, CircleDashed, Receipt } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Switch } from '@project/components/ui/switch';
import { useWorkspace } from '../../lib/workspace';
import { MoneyInput, NumberInput, Segmented, TextArea } from '../form/fields';
import { Note } from './controls';
import { Group, OrgSettingsForm, Row } from './form';
import { firstLateDay, lateFeeFor, ordinal } from './rules';

const FIELDS = [
  'rentDueDay', 'gracePeriodDays', 'lateFeeType', 'lateFeeAmount', 'lateFeePercent', 'lateFeeMax', 'chargeDaysAhead', 'rentReminderDays', 'allowPartialPayments', 'onlinePayments', 'paymentInstructions',
] as const;

/** A rent people here actually charge, for the late-fee example: the median current rent, or $1,850. */
function useExampleRent() {
  const ws = useWorkspace();
  return useMemo(() => {
    const rents = ws.units.map(u => u.currentRent).filter((r): r is number => r != null && r > 0).sort((a, b) => a - b);
    if (!rents.length) return 1850;
    return Math.round(rents[Math.floor(rents.length / 2)] / 25) * 25;
  }, [ws.units]);
}

/** Settings → Rent & fees: due day, grace period and late fees (with a worked example), reminders and payments. */
export default function RentFeesSection() {
  const ws = useWorkspace();
  const rent = useExampleRent();
  return (
    <OrgSettingsForm section="rent" fields={FIELDS}>
      {({ data, draft, set, errors }) => {
        const policyValid = !errors.lateFeeAmount && !errors.lateFeePercent && !errors.lateFeeMax && !errors.gracePeriodDays && !errors.rentDueDay;
        const fee = lateFeeFor({ lateFeeType: draft.lateFeeType, lateFeeAmount: draft.lateFeeAmount ?? 0, lateFeePercent: draft.lateFeePercent ?? 0, lateFeeMax: draft.lateFeeMax }, rent);
        const dueDay = draft.rentDueDay && draft.rentDueDay >= 1 && draft.rentDueDay <= 28 ? draft.rentDueDay : 1;
        const grace = draft.gracePeriodDays != null && draft.gracePeriodDays >= 0 && draft.gracePeriodDays <= 28 ? draft.gracePeriodDays : 0;
        const uncapped = draft.lateFeeType === 'Percent' ? Math.round(rent * (draft.lateFeePercent ?? 0)) / 100 : draft.lateFeeAmount ?? 0;
        const capped = draft.lateFeeMax != null && draft.lateFeeMax > 0 && uncapped > draft.lateFeeMax;
        const stripe = data.integrations.stripe;
        const m = (n: number | null | undefined) => ws.money(n ?? 0, { cents: Math.round((n ?? 0) * 100) % 100 !== 0 });
        return (
          <>
            <Group title="Rent">
              <Row
                label="Rent due day"
                htmlFor="rent-due"
                error={errors.rentDueDay}
                description={`${draft.rentDueDay && draft.rentDueDay >= 1 && draft.rentDueDay <= 28 ? `The ${ordinal(draft.rentDueDay)} of each month. ` : ''}New leases start with this; a lease can set its own day.`}
              >
                <div data-field="rentDueDay"><NumberInput id="rent-due" min={1} max={28} value={draft.rentDueDay} onChange={v => set('rentDueDay', v as number)} invalid={Boolean(errors.rentDueDay)} suffix="of the month" className="[&_input]:pr-24" /></div>
              </Row>
              <Row label="Post rent charges" htmlFor="rent-ahead" error={errors.chargeDaysAhead} description={draft.chargeDaysAhead ? `Rent shows on residents’ ledgers ${draft.chargeDaysAhead} ${draft.chargeDaysAhead === 1 ? 'day' : 'days'} before it’s due.` : 'Rent is added to residents’ ledgers on the day it’s due.'}>
                <div data-field="chargeDaysAhead"><NumberInput id="rent-ahead" min={0} max={28} value={draft.chargeDaysAhead} onChange={v => set('chargeDaysAhead', v as number)} invalid={Boolean(errors.chargeDaysAhead)} suffix="days before" className="[&_input]:pr-24" /></div>
              </Row>
              <Row
                label="Rent reminders"
                htmlFor="rent-reminder"
                error={errors.rentReminderDays}
                description={
                  draft.rentReminderDays ? (
                    <>Residents get the <Link to="/settings/templates" className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground">Rent reminder email</Link> {draft.rentReminderDays} {draft.rentReminderDays === 1 ? 'day' : 'days'} before rent is due.</>
                  ) : 'Off — set a number of days to remind residents before rent is due.'
                }
              >
                <div data-field="rentReminderDays"><NumberInput id="rent-reminder" min={0} max={28} value={draft.rentReminderDays} onChange={v => set('rentReminderDays', v as number)} invalid={Boolean(errors.rentReminderDays)} suffix="days before" className="[&_input]:pr-24" /></div>
              </Row>
            </Group>

            <Group title="Late fees">
              <Row label="Grace period" htmlFor="rent-grace" error={errors.gracePeriodDays} description="Days after the due date before rent counts as late.">
                <div data-field="gracePeriodDays"><NumberInput id="rent-grace" min={0} max={28} value={draft.gracePeriodDays} onChange={v => set('gracePeriodDays', v as number)} invalid={Boolean(errors.gracePeriodDays)} suffix="days" /></div>
              </Row>
              <Row label="Late fee" description="Charged once per month, by the morning automation, on rent still unpaid after the grace period.">
                <div data-field="lateFeeType" className="sm:flex sm:justify-end">
                  <Segmented
                    value={draft.lateFeeType}
                    onChange={v => set('lateFeeType', v as 'None' | 'Flat' | 'Percent')}
                    options={[{ value: 'None', label: 'None' }, { value: 'Flat', label: 'Flat amount' }, { value: 'Percent', label: 'Percent of rent' }]}
                  />
                </div>
              </Row>
              {draft.lateFeeType === 'Flat' && (
                <Row label="Amount" htmlFor="rent-fee" error={errors.lateFeeAmount}>
                  <div data-field="lateFeeAmount"><MoneyInput id="rent-fee" value={draft.lateFeeAmount} onChange={v => set('lateFeeAmount', v as number)} invalid={Boolean(errors.lateFeeAmount)} prefix={ws.money(0).replace(/[\d.,\s]/g, '') || '$'} /></div>
                </Row>
              )}
              {draft.lateFeeType === 'Percent' && (
                <Row label="Percent of monthly rent" htmlFor="rent-pct" error={errors.lateFeePercent}>
                  <div data-field="lateFeePercent"><NumberInput id="rent-pct" min={0} max={100} step={0.5} value={draft.lateFeePercent} onChange={v => set('lateFeePercent', v as number)} invalid={Boolean(errors.lateFeePercent)} suffix="%" /></div>
                </Row>
              )}
              {draft.lateFeeType !== 'None' && (
                <Row label="Never more than" htmlFor="rent-max" error={errors.lateFeeMax} description="Many states cap late fees. Leave empty for no cap.">
                  <div data-field="lateFeeMax"><MoneyInput id="rent-max" value={draft.lateFeeMax} onChange={v => set('lateFeeMax', v)} invalid={Boolean(errors.lateFeeMax)} placeholder="No cap" prefix={ws.money(0).replace(/[\d.,\s]/g, '') || '$'} /></div>
                </Row>
              )}
              <Note icon={<Receipt />}>
                {draft.lateFeeType === 'None' ? (
                  <span>Late rent isn’t charged a fee. Residents still see what they owe, and you can add a fee to a lease by hand.</span>
                ) : policyValid && fee > 0 ? (
                  <span data-testid="late-fee-example">
                    A <strong className="font-medium num">{m(rent)}</strong> rent due on the {ordinal(dueDay)} and still unpaid on {firstLateDay(dueDay, grace)} gets a{' '}
                    <strong className="font-medium num">{m(fee)}</strong> late fee
                    {draft.lateFeeType === 'Percent' && <> ({draft.lateFeePercent}% of rent{capped ? `, capped at ${m(draft.lateFeeMax)}` : ''})</>}
                    {draft.lateFeeType === 'Flat' && capped && <> (capped at {m(draft.lateFeeMax)})</>}.
                  </span>
                ) : (
                  <span className="text-muted-foreground">Finish the late fee above to see an example.</span>
                )}
              </Note>
            </Group>

            <Group title="Payments">
              <Row
                label="Online payments"
                description={
                  <>
                    Residents pay rent by card or bank transfer in the portal, and it posts to their ledger automatically.
                    <span className="mt-1.5 flex items-center gap-1.5">
                      {stripe ? <CircleCheck className="h-3.5 w-3.5 text-tone-success" /> : <CircleDashed className="h-3.5 w-3.5" />}
                      {stripe ? (
                        <span className="text-foreground">Stripe is connected.</span>
                      ) : (
                        <span>Needs Stripe connected — see <Link to="/settings/integrations" className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground">Integrations</Link>. Until then residents see your payment instructions.</span>
                      )}
                    </span>
                  </>
                }
              >
                <div className="flex sm:justify-end"><Switch aria-label="Online payments" checked={draft.onlinePayments} onCheckedChange={v => set('onlinePayments', v)} /></div>
              </Row>
              <Row label="Allow partial payments" description={draft.allowPartialPayments ? 'Residents can pay any amount up to their balance online.' : 'Online payments must cover the full balance.'}>
                <div className="flex sm:justify-end"><Switch aria-label="Allow partial payments" checked={draft.allowPartialPayments} onCheckedChange={v => set('allowPartialPayments', v)} /></div>
              </Row>
              <Row label="Payment instructions" htmlFor="rent-instructions" error={errors.paymentInstructions} description="Shown on the portal’s payment page — how to pay by check, where to drop it off, what to write in the memo." stacked>
                <div data-field="paymentInstructions"><TextArea id="rent-instructions" rows={3} value={draft.paymentInstructions} onChange={e => set('paymentInstructions', e.target.value)} placeholder="Pay online in the portal, or send a check payable to our office with your unit number in the memo." /></div>
              </Row>
            </Group>
          </>
        );
      }}
    </OrgSettingsForm>
  );
}
