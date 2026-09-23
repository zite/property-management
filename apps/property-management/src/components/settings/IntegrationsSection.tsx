import { CreditCard, Mail, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pill } from '../primitives/glyphs';
import { useOrgSettings } from './data';
import { Group, SectionError, SectionHeader, SectionSkeleton } from './form';

const link = 'text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground';

/** Settings → Integrations: read-only status for email, AI and online payments, and how to turn each on. */
export default function IntegrationsSection() {
  const q = useOrgSettings();
  if (q.isPending) return <SectionSkeleton rows={3} />;
  if (q.isError || !q.data) return <SectionError error={q.error} onRetry={() => void q.refetch()} />;
  const { integrations, settings } = q.data;

  return (
    <>
      <SectionHeader title="Integrations" description="Services this app connects to. They’re set up in the Zite editor, where your workspace’s connections live — this page shows what’s working." />
      <Group>
        <Integration
          icon={<Mail />}
          name="Email"
          status={<Pill tone="success">Built in</Pill>}
          description="Receipts, reminders, notices, invites and every message your team sends are delivered by Zite’s email service. Nothing to set up."
          detail={
            settings.supportEmail ? (
              <>Replies go to <span className="font-medium text-foreground">{settings.supportEmail}</span>.</>
            ) : (
              <>Replies have nowhere to go yet — <Link to="/settings/general" className={link}>add a support email</Link>.</>
            )
          }
        />
        <Integration
          icon={<Sparkles />}
          name="AI assist"
          status={integrations.ai ? <Pill tone="success">On</Pill> : <Pill tone="neutral">Off</Pill>}
          description="Reads a new maintenance request and suggests a title, category and priority. It never makes decisions about applicants or residents."
          detail={integrations.ai ? 'Connected through your workspace’s Anthropic connection.' : 'Categories are suggested from keywords instead. To turn AI on, connect Anthropic to the Property Management app in the Zite editor (Integrations → Anthropic).'}
        />
        <Integration
          icon={<CreditCard />}
          name="Online payments"
          status={integrations.stripe ? <Pill tone="success">Connected</Pill> : <Pill tone="warning">Not connected</Pill>}
          description="Residents pay rent and applicants pay application fees by card or bank transfer in the portal. Payments post to the ledger on their own, and the money goes to your Stripe account."
          detail={
            integrations.stripe ? (
              <>Stripe is connected. {settings.onlinePayments ? 'Online payments are on.' : <>Online payments are switched off — <Link to="/settings/rent" className={link}>turn them on in Rent & fees</Link>.</>}</>
            ) : (
              <>Connect Stripe to the Resident Portal app in the Zite editor (Integrations → Stripe), then check <Link to="/settings/rent" className={link}>Rent & fees</Link>. Until then residents see your payment instructions.</>
            )
          }
        />
      </Group>
    </>
  );
}

function Integration({ icon, name, status, description, detail }: { icon: ReactNode; name: string; status: ReactNode; description: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex gap-3.5 px-4 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-subtle text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">{name}</span>
          {status}
        </div>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{description}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
