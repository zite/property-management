import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { confirmRentPayment, createRentPayment } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { formatMoney, shortDate } from '../../lib/format';
import { useRefreshResident, type ResidentLedger } from '../../lib/residentQueries';
import { Alert, Button, Card, LinkButton } from '../ui';

/**
 * Paying online with the organization's Stripe account: choose an amount,
 * enter a card or bank account in Stripe's own form, confirm. The server
 * creates the payment and records it in the books once Stripe says it went
 * through — the page never decides that money moved.
 */

const PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? '';
let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = () => (stripePromise ??= loadStripe(PUBLISHABLE_KEY));

export const stripeKeyPresent = () => Boolean(PUBLISHABLE_KEY);

type Stage = { step: 'amount' } | { step: 'pay'; intentId: string; clientSecret: string; amount: number } | { step: 'done'; amount: number; receiptNumber: number | null } | { step: 'processing'; amount: number };

export function PayOnline({ leaseId, ledger, brandColor }: { leaseId: string; ledger: ResidentLedger; brandColor: string }) {
  const [stage, setStage] = useState<Stage>({ step: 'amount' });
  const refresh = useRefreshResident();
  const m = (n: number) => formatMoney(n, ledger.currency);

  // Some bank payments leave the page to authenticate and come back with the intent in the URL.
  const returned = useRef(false);
  const confirmReturn = useMutation({
    mutationFn: (intentId: string) => confirmRentPayment({ leaseId, intentId }),
    onSuccess: res => {
      void refresh();
      if (res.status === 'Succeeded') setStage({ step: 'done', amount: res.amount, receiptNumber: res.receiptNumber });
      else if (res.status === 'Processing') setStage({ step: 'processing', amount: res.amount });
    },
  });
  useEffect(() => {
    if (returned.current) return;
    const params = new URLSearchParams(window.location.search);
    const intentId = params.get('payment_intent');
    if (!intentId) return;
    returned.current = true;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
    confirmReturn.mutate(intentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage.step === 'done') {
    return (
      <Card className="p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-tone-success/10 text-tone-success animate-pop">
          <CheckCircle2 className="h-8 w-8" aria-hidden />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Payment received</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[15px] text-muted-foreground">
          Thanks — {m(stage.amount)} is on your account{stage.receiptNumber ? ` (receipt #${stage.receiptNumber})` : ''}. We’ve emailed you a receipt.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <LinkButton to="/resident/payments" variant="ink">
            See your payments
          </LinkButton>
          <LinkButton to="/resident" variant="ghost">
            Back to home
          </LinkButton>
        </div>
      </Card>
    );
  }

  if (stage.step === 'processing') {
    return (
      <Card className="p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-tone-info/10 text-tone-info">
          <Clock className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Your payment is on its way</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[15px] text-muted-foreground">Bank payments take 3–5 business days to clear. {m(stage.amount)} will show in your payments as soon as it does — you don’t need to do anything else.</p>
        <LinkButton to="/resident/payments" variant="ink" className="mt-6">
          See your payments
        </LinkButton>
      </Card>
    );
  }

  if (stage.step === 'pay') {
    return (
      <Elements
        stripe={getStripe()}
        options={{
          clientSecret: stage.clientSecret,
          appearance: { theme: document.documentElement.classList.contains('dark') ? 'night' : 'stripe', variables: { colorPrimary: brandColor, borderRadius: '10px', fontSizeBase: '15px' } },
        }}
      >
        <CheckoutForm
          leaseId={leaseId}
          intentId={stage.intentId}
          amount={stage.amount}
          currency={ledger.currency}
          onBack={() => setStage({ step: 'amount' })}
          onDone={(status, receiptNumber) => {
            void refresh();
            setStage(status === 'Processing' ? { step: 'processing', amount: stage.amount } : { step: 'done', amount: stage.amount, receiptNumber });
          }}
        />
      </Elements>
    );
  }

  return (
    <>
      {confirmReturn.isPending && <Alert tone="info" title="Checking your payment…" className="mb-4" />}
      {confirmReturn.isError && (
        <Alert tone="danger" title="We couldn’t confirm that payment" className="mb-4">
          {errorMessage(confirmReturn.error, 'Check your payments in a few minutes before trying again, so you aren’t charged twice.')}
        </Alert>
      )}
      <AmountStep leaseId={leaseId} ledger={ledger} onReady={s => setStage({ step: 'pay', ...s })} />
    </>
  );
}

function AmountStep({ leaseId, ledger, onReady }: { leaseId: string; ledger: ResidentLedger; onReady: (s: { intentId: string; clientSecret: string; amount: number }) => void }) {
  const id = useId();
  const m = (n: number) => formatMoney(n, ledger.currency);
  const next = ledger.nextCharges;
  const options = [
    ...(ledger.balance > 0 ? [{ key: 'balance', label: 'Full balance', amount: ledger.balance, hint: ledger.pastDue > 0 ? `Includes ${m(ledger.pastDue)} past due` : 'Everything you owe today' }] : []),
    ...(ledger.balance <= 0 && next ? [{ key: 'next', label: 'Next charges', amount: next.total, hint: `Due ${shortDate(next.dueDate)} — pay early and it’s applied when they post` }] : []),
  ];
  const [choice, setChoice] = useState(options[0]?.key ?? (ledger.allowPartialPayments ? 'other' : ''));
  const [other, setOther] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (amount: number) => createRentPayment({ leaseId, amount }),
    onSuccess: res => onReady({ intentId: res.intentId, clientSecret: res.clientSecret, amount: res.amount }),
    onError: e => setProblem(errorMessage(e, "We couldn't start the payment. Try again.")),
  });

  const amount = choice === 'other' ? Number(other.replace(/[^\d.]/g, '')) : options.find(o => o.key === choice)?.amount ?? 0;

  const submit = () => {
    if (choice === 'other') {
      if (!(amount >= 1)) return setProblem(`Enter an amount of at least ${m(1)}.`);
      if (amount > ledger.paymentCeiling) return setProblem(`The most you can pay online at once is ${m(ledger.paymentCeiling)}.`);
    }
    if (!(amount > 0)) return setProblem('Choose how much to pay.');
    setProblem(null);
    create.mutate(Math.round(amount * 100) / 100);
  };

  if (!options.length && !ledger.allowPartialPayments) {
    return (
      <Card className="p-6">
        <p className="text-[15px]">There’s nothing to pay right now. Your next charges will show here when they’re due.</p>
      </Card>
    );
  }

  return (
    <Card as="section" className="p-5 sm:p-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        How much would you like to pay?
      </h2>
      <form
        className="mt-4"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <div role="radiogroup" aria-labelledby={`${id}-h`} className="space-y-2.5">
          {options.map(o => (
            <label key={o.key} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-accent/40', choice === o.key && 'border-primary bg-primary/[0.04] ring-1 ring-primary')}>
              <input type="radio" name={`${id}-amount`} value={o.key} checked={choice === o.key} onChange={() => setChoice(o.key)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{o.label}</span>
                <span className="block text-sm text-muted-foreground">{o.hint}</span>
              </span>
              <span className="shrink-0 text-lg font-semibold tabular-nums">{m(o.amount)}</span>
            </label>
          ))}
          {ledger.allowPartialPayments && (
            <label className={cn('flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-accent/40', choice === 'other' && 'border-primary bg-primary/[0.04] ring-1 ring-primary')}>
              <input type="radio" name={`${id}-amount`} value="other" checked={choice === 'other'} onChange={() => setChoice('other')} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              <span className="min-w-0 flex-1 text-[15px] font-medium">Another amount</span>
              <span className="relative w-full sm:w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  value={other}
                  onFocus={() => setChoice('other')}
                  onChange={e => {
                    setOther(e.target.value.replace(/[^\d.,]/g, ''));
                    setChoice('other');
                    setProblem(null);
                  }}
                  placeholder="0.00"
                  aria-label="Amount to pay"
                  className="h-11 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-right text-[15px] tabular-nums shadow-xs focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15"
                />
              </span>
            </label>
          )}
        </div>
        {problem && (
          <p role="alert" className="mt-3 text-sm text-tone-danger">
            {problem}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-5 w-full" loading={create.isPending} disabled={!(amount > 0)}>
          Continue{amount > 0 ? ` with ${m(amount)}` : ''}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Secure payment by Stripe. Card or bank account.
        </p>
      </form>
    </Card>
  );
}

function CheckoutForm({ leaseId, intentId, amount, currency, onBack, onDone }: { leaseId: string; intentId: string; amount: number; currency: string; onBack: () => void; onDone: (status: 'Succeeded' | 'Processing', receiptNumber: number | null) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setProblem(null);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      });
      if (error) {
        setProblem(error.message ?? 'Your payment didn’t go through. Check the details and try again.');
        return;
      }
      if (paymentIntent && paymentIntent.id !== intentId) throw new Error('Payment mismatch');
      const res = await confirmRentPayment({ leaseId, intentId });
      if (res.status === 'Succeeded' || res.status === 'Processing') onDone(res.status, res.receiptNumber);
      else if (res.status === 'Failed') setProblem(res.message ?? 'Your payment didn’t go through.');
      else setProblem('Your payment hasn’t finished yet. Check your payments in a minute before trying again.');
    } catch (e) {
      setProblem(errorMessage(e, 'We couldn’t confirm your payment. Check your payments before trying again, so you aren’t charged twice.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" className="p-5 sm:p-6">
      <button type="button" onClick={onBack} disabled={busy} className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Change amount
      </button>
      <h2 className="mt-2 text-lg font-semibold">Pay {formatMoney(amount, currency)}</h2>
      <form
        className="mt-4"
        onSubmit={e => {
          e.preventDefault();
          void pay();
        }}
      >
        <div className={cn('min-h-[180px] transition-opacity', !ready && 'opacity-60')}>
          <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
        </div>
        {problem && (
          <Alert tone="danger" className="mt-4">
            {problem}
          </Alert>
        )}
        <Button type="submit" size="lg" className="mt-5 w-full" loading={busy} disabled={!stripe || !elements || !ready}>
          Pay {formatMoney(amount, currency)}
        </Button>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          By paying you authorize this one-time charge. <Link to="/resident/payments" className="font-medium text-primary hover:underline">Payment history</Link>
        </p>
      </form>
    </Card>
  );
}
