import { AlertTriangle } from 'lucide-react';
import { TextArea, TextInput } from '../form/fields';
import { ColorField, contrastNote, CurrencyPicker, ImageUpload, LogoMark, Note, TimezonePicker } from './controls';
import { Group, OrgSettingsForm, Row } from './form';

const FIELDS = [
  'organizationName', 'legalName', 'websiteUrl', 'logoUrl', 'brandColor', 'phone', 'supportEmail', 'emergencyPhone', 'officeHours', 'address', 'timezone', 'currency', 'emailSignature',
] as const;

/** Settings → Organization: who the company is, how it looks and how to reach it. */
export default function OrganizationSection() {
  return (
    <OrgSettingsForm section="general" fields={FIELDS}>
      {({ draft, set, errors, saved }) => {
        const contrast = contrastNote(draft.brandColor);
        return (
          <>
            <Group title="Company">
              <Row label="Logo" description="Shown in the portal header, in emails and in the sidebar. A square image works best.">
                <ImageUpload value={draft.logoUrl} onChange={v => set('logoUrl', v)} name={draft.organizationName} color={draft.brandColor} label="logo" />
              </Row>
              <Row label="Company name" htmlFor="org-name" error={errors.organizationName} description="How residents, owners and vendors see you.">
                <div data-field="organizationName">
                  <TextInput id="org-name" value={draft.organizationName} invalid={Boolean(errors.organizationName)} onChange={e => set('organizationName', e.target.value)} placeholder="Cedar & Main Property Management" />
                </div>
              </Row>
              <Row label="Legal name" htmlFor="org-legal" error={errors.legalName} description="Used where checks should be made payable. Leave empty to use the company name.">
                <div data-field="legalName">
                  <TextInput id="org-legal" value={draft.legalName} onChange={e => set('legalName', e.target.value)} placeholder={draft.organizationName || 'Legal name'} />
                </div>
              </Row>
              <Row label="Website" htmlFor="org-web" error={errors.websiteUrl}>
                <div data-field="websiteUrl">
                  <TextInput
                    id="org-web"
                    inputMode="url"
                    value={draft.websiteUrl ?? ''}
                    invalid={Boolean(errors.websiteUrl)}
                    onChange={e => set('websiteUrl', e.target.value || null)}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v && !/^https?:\/\//i.test(v)) set('websiteUrl', `https://${v}`);
                    }}
                    placeholder="https://yourcompany.com"
                  />
                </div>
              </Row>
            </Group>

            <Group title="Brand">
              <Row label="Brand colour" htmlFor="org-color" error={errors.brandColor} description="The portal uses it for its main buttons, links and focus rings. This app’s own interface doesn’t change." stacked>
                <div data-field="brandColor" className="flex flex-wrap items-start gap-6">
                  <ColorField id="org-color" value={draft.brandColor} onChange={v => set('brandColor', v)} invalid={Boolean(errors.brandColor)} />
                  <PortalSwatchPreview name={draft.organizationName} logoUrl={draft.logoUrl} color={/^#[0-9a-f]{6}$/i.test(draft.brandColor) ? draft.brandColor : saved.brandColor} />
                </div>
              </Row>
              {contrast && !errors.brandColor && (
                <Note tone="warning" icon={<AlertTriangle />}>{contrast}</Note>
              )}
            </Group>

            <Group title="Contact" description="Shown in the portal and available as merge tags in emails.">
              <Row label="Office phone" htmlFor="org-phone" error={errors.phone}>
                <div data-field="phone"><TextInput id="org-phone" type="tel" value={draft.phone} onChange={e => set('phone', e.target.value)} placeholder="(303) 555-0142" /></div>
              </Row>
              <Row label="Support email" htmlFor="org-email" error={errors.supportEmail} description="Replies to automated emails go here.">
                <div data-field="supportEmail">
                  <TextInput id="org-email" type="email" value={draft.supportEmail ?? ''} invalid={Boolean(errors.supportEmail)} onChange={e => set('supportEmail', e.target.value || null)} placeholder="help@yourcompany.com" />
                </div>
              </Row>
              <Row label="Emergency maintenance line" htmlFor="org-emergency" error={errors.emergencyPhone} description="Residents are told to call it for no heat, flooding, gas or no power — any time.">
                <div data-field="emergencyPhone"><TextInput id="org-emergency" type="tel" value={draft.emergencyPhone} onChange={e => set('emergencyPhone', e.target.value)} placeholder={draft.phone || '(303) 555-0199'} /></div>
              </Row>
              <Row label="Office hours" htmlFor="org-hours" error={errors.officeHours}>
                <div data-field="officeHours"><TextInput id="org-hours" value={draft.officeHours} onChange={e => set('officeHours', e.target.value)} placeholder="Mon–Fri, 9am–5pm" /></div>
              </Row>
              <Row label="Office address" htmlFor="org-address" error={errors.address} description="Where residents drop off checks and mail notices.">
                <div data-field="address"><TextArea id="org-address" rows={2} className="min-h-[60px]" value={draft.address} onChange={e => set('address', e.target.value)} placeholder={'2400 Blake St, Suite 310\nDenver, CO 80205'} /></div>
              </Row>
            </Group>

            <Group title="Region">
              <Row label="Timezone" htmlFor="org-tz" error={errors.timezone} description="Decides when “today” starts — when rent is due, late fees and the morning automation.">
                <div data-field="timezone"><TimezonePicker id="org-tz" value={draft.timezone} onChange={v => set('timezone', v)} invalid={Boolean(errors.timezone)} /></div>
              </Row>
              <Row label="Currency" htmlFor="org-currency" error={errors.currency} description={draft.currency !== saved.currency ? 'Amounts already recorded aren’t converted — only how they’re shown changes.' : 'How amounts are shown everywhere.'}>
                <div data-field="currency"><CurrencyPicker id="org-currency" value={draft.currency} onChange={v => set('currency', v)} /></div>
              </Row>
            </Group>

            <Group title="Email signature">
              <Row label="Signature" htmlFor="org-signature" error={errors.emailSignature} description="Added below emails to residents, owners, vendors and applicants." stacked>
                <div data-field="emailSignature">
                  <TextArea id="org-signature" rows={3} value={draft.emailSignature} onChange={e => set('emailSignature', e.target.value)} placeholder={`${draft.organizationName || 'Your company'}\n${draft.phone || '(303) 555-0142'}`} />
                </div>
              </Row>
            </Group>
          </>
        );
      }}
    </OrgSettingsForm>
  );
}

/** How the brand colour will read in the portal: a header with the logo and a primary button. */
function PortalSwatchPreview({ name, logoUrl, color }: { name: string; logoUrl: string | null; color: string }) {
  return (
    <div aria-hidden className="w-[240px] max-w-full overflow-hidden rounded-lg border bg-background text-[13px] shadow-2xs">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <LogoMark url={logoUrl} color={color} className="h-4 w-4" />
        <span className="truncate font-medium">{name || 'Your company'}</span>
      </div>
      <div className="space-y-2 px-3 py-3">
        <div className="text-muted-foreground">Rent due Oct 1</div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-md px-3 font-medium text-white" style={{ background: color }}>Pay rent</span>
          <span className="font-medium underline-offset-2" style={{ color }}>View ledger</span>
        </div>
      </div>
    </div>
  );
}
