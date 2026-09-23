import { ArrowUpRight, CircleCheck, CircleSlash, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { TextArea, TextInput } from '../form/fields';
import { CopyField, LogoMark, Note } from './controls';
import { Group, OrgSettingsForm, Row } from './form';

const FIELDS = ['portalHeadline', 'portalIntro'] as const;

/** Settings → Resident portal: its address, the welcome copy, and what's switched on there. */
export default function PortalSection() {
  return (
    <OrgSettingsForm section="portal" fields={FIELDS}>
      {({ data, draft, set, errors }) => {
        const s = data.settings;
        const features: Array<{ label: string; on: boolean; detail: string; to: string }> = [
          { label: 'Online rent payments', on: s.onlinePayments && data.integrations.stripe, detail: !s.onlinePayments ? 'Off' : data.integrations.stripe ? 'On' : 'On, waiting for Stripe', to: '/settings/rent' },
          { label: 'Maintenance requests', on: s.maintenanceRequests, detail: s.maintenanceRequests ? 'On' : 'Off', to: '/settings/maintenance' },
          { label: 'Rental applications', on: s.applicationsOpen, detail: s.applicationsOpen ? 'On' : 'Off', to: '/settings/leasing' },
        ];
        return (
          <>
            <Group title="Address">
              <Row label="Portal link" description="Residents, owners, vendors and applicants all sign in here with their email. Outgoing emails link to it." stacked>
                <CopyField value={data.portalUrl} placeholder="Not known yet" openLabel="Open the portal" />
              </Row>
              {!data.portalUrl && (
                <Note icon={<Info />}>The portal records its own address the first time someone opens it. Publish the Resident Portal app and open it once — the link appears here and in every email.</Note>
              )}
            </Group>

            <Group title="Welcome">
              <Row label="Headline" htmlFor="portal-headline" error={errors.portalHeadline} stacked>
                <div data-field="portalHeadline"><TextInput id="portal-headline" value={draft.portalHeadline} maxLength={120} onChange={e => set('portalHeadline', e.target.value)} placeholder="Welcome home" /></div>
              </Row>
              <Row label="Introduction" htmlFor="portal-intro" error={errors.portalIntro} description={`${draft.portalIntro.length} of 600 characters`} stacked>
                <div data-field="portalIntro"><TextArea id="portal-intro" rows={3} value={draft.portalIntro} onChange={e => set('portalIntro', e.target.value)} placeholder="Pay rent, request maintenance and reach our team — all in one place." /></div>
              </Row>
              <div className="bg-subtle/60 px-4 py-4">
                <div className="mb-2 text-sm text-muted-foreground">Preview</div>
                <PortalPreview name={s.organizationName} logoUrl={s.logoUrl} color={s.brandColor} headline={draft.portalHeadline || 'Welcome home'} intro={draft.portalIntro} />
              </div>
            </Group>

            <Group title="Features" description="Switched on and off in the settings they belong to.">
              {features.map(f => (
                <FeatureRow key={f.label} label={f.label} on={f.on} detail={f.detail} to={f.to} />
              ))}
            </Group>
          </>
        );
      }}
    </OrgSettingsForm>
  );
}

function FeatureRow({ label, on, detail, to }: { label: string; on: boolean; detail: ReactNode; to: string }) {
  return (
    <Link to={to} className="group flex h-11 items-center gap-2.5 px-4 text-[14px] hover:bg-accent/50">
      {on ? <CircleCheck className="h-4 w-4 text-tone-success" /> : <CircleSlash className="h-4 w-4 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className={cn('text-sm', on ? 'text-foreground/80' : 'text-muted-foreground')}>{detail}</span>
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

/** The portal's welcome as a resident sees it, with the organization's logo and brand colour. */
function PortalPreview({ name, logoUrl, color, headline, intro }: { name: string; logoUrl: string | null; color: string; headline: string; intro: string }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl border bg-background shadow-xs">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <LogoMark url={logoUrl} color={color} className="h-5 w-5" />
        <span className="truncate text-[14px] font-semibold">{name}</span>
        <span className="ml-auto text-sm text-muted-foreground">Sign in</span>
      </div>
      <div className="px-5 py-6 sm:px-8">
        <div className="text-[20px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{headline}</div>
        {intro && <p className="mt-2 max-w-[520px] text-[14.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{intro}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex h-9 items-center rounded-lg px-3.5 text-[14px] font-medium text-white" style={{ background: color }}>Pay rent</span>
          <span className="inline-flex h-9 items-center rounded-lg border px-3.5 text-[14px] font-medium">Browse rentals</span>
        </div>
      </div>
    </div>
  );
}
