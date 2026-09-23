import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Lock } from 'lucide-react';
import { useState } from 'react';
import { confirmApplicationFeePayment, createApplicationFeePayment } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useIsDark } from '../../lib/theme';
import { Alert, Button, Skeleton } from '../ui';

/**
 * Paying the application fee by card, then submitting — one button, in that
 * order, so nobody pays for an application that then fails validation.
 *
 * This file is only loaded when the organization has Stripe connected
 * (`features.stripeReady`), so the Stripe script never loads otherwise.
 */

// The publishable key can be briefly missing while the dev server restarts after Stripe is first connected.
const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = pk ? loadStripe(pk) : null;

type Props = {
  applicationId: string;
  amount: number;
  currency: string;
  /** Checks consent and signature and saves the latest answers. Resolves false to stop before charging. */
  beforePay: () => Promise<boolean>;
  /** Called once the fee is paid (or was already); submits the application. */
  onPaid: () => Promise<void>;
  submitting: boolean;
};

export default function FeePayment(props: Props) {
  const { applicationId } = props;
  const dark = useIsDark();
  const intent = useQuery({
    queryKey: ['portal', 'applications', 'fee', applicationId],
    queryFn: () => createApplicationFeePayment({ id: applicationId }),
    // No publishable key, no payment form: don't create an intent nobody can pay.
    enabled: Boolean(stripePromise),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!stripePromise) {
    return <Alert tone="warning" title="Card payments are still connecting">Reload the page in a moment. Your answers are saved.</Alert>;
  }
  if (intent.isPending) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (intent.isError || !intent.data) {
    return (
      <Alert tone="danger" title="The payment form didn’t load" action={<Button variant="secondary" size="sm" onClick={() => intent.refetch()}>Try again</Button>}>
        {errorMessage(intent.error, 'Check your connection and try again. You haven’t been charged.')}
      </Alert>
    );
  }

  const { status, clientSecret, paymentIntentId } = intent.data;
  if (status !== 'requires_payment' || !clientSecret) {
    return <AlreadyPaid {...props} paymentIntentId={paymentIntentId} status={status} />;
  }
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: dark ? 'night' : 'stripe',
          variables: { borderRadius: '8px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSizeBase: '15px' },
        },
      }}
    >
      <PayForm {...props} paymentIntentId={paymentIntentId!} />
    </Elements>
  );
}

function AlreadyPaid({ applicationId, onPaid, beforePay, submitting, paymentIntentId, status }: Props & { paymentIntentId: string | null; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    if (!(await beforePay())) return;
    try {
      // A payment that went through on an earlier visit still needs recording before the application can be sent.
      if (paymentIntentId && (status === 'succeeded' || status === 'processing')) await confirmApplicationFeePayment({ id: applicationId, paymentIntentId });
      await onPaid();
    } catch (e) {
      setError(errorMessage(e, 'Your application wasn’t submitted. Try again.'));
    }
  };
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-[15px] font-medium text-tone-success">
        <CheckCircle2 className="h-5 w-5" aria-hidden /> {status === 'free' ? 'No fee to pay' : status === 'processing' ? 'Payment processing' : 'Fee paid'}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button size="lg" className="w-full sm:w-auto" onClick={go} loading={submitting}>
        Submit application
      </Button>
    </div>
  );
}

function PayForm({ applicationId, amount, currency, beforePay, onPaid, submitting, paymentIntentId }: Props & { paymentIntentId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements || busy) return;
    setError(null);
    if (!(await beforePay())) return;
    setBusy(true);
    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if (stripeError) {
        setError(stripeError.message ?? 'Your card wasn’t charged. Check the details and try again.');
        return;
      }
      const res = await confirmApplicationFeePayment({ id: applicationId, paymentIntentId: paymentIntent?.id ?? paymentIntentId });
      if (res.status === 'succeeded' || res.status === 'processing') {
        await onPaid();
      } else {
        setError(res.message ?? 'The payment didn’t go through. Try again.');
      }
    } catch (e) {
      setError(errorMessage(e, 'Something went wrong. If your card was charged, your fee is recorded — press the button again to submit.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      {!ready && <Skeleton className="h-32 w-full rounded-lg" />}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" onClick={pay} loading={busy || submitting} disabled={!stripe || !elements || !ready}>
          <Lock aria-hidden /> Pay {formatMoney(amount, currency)} and submit
        </Button>
        <p className="text-sm text-muted-foreground">Processed securely by Stripe.</p>
      </div>
    </div>
  );
}
