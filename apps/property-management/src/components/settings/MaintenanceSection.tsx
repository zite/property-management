import { Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Switch } from '@project/components/ui/switch';
import { useWorkspace } from '../../lib/workspace';
import { MoneyInput, NumberInput } from '../form/fields';
import { Note } from './controls';
import { Group, OrgSettingsForm, Row } from './form';

const FIELDS = ['managementFeePercent', 'ownerApprovalThreshold', 'maintenanceRequests'] as const;

/** Settings → Maintenance & owners: the default management fee, owner approvals and portal requests. */
export default function MaintenanceSection() {
  const ws = useWorkspace();
  return (
    <OrgSettingsForm section="maintenance" fields={FIELDS}>
      {({ data, draft, set, errors }) => (
        <>
          <Group title="Owners">
            <Row
              label="Default management fee"
              htmlFor="mx-fee"
              error={errors.managementFeePercent}
              description="A percentage of rent collected, posted for each property when the month closes. Used when neither the property nor its owner has a rate of its own."
            >
              <div data-field="managementFeePercent"><NumberInput id="mx-fee" min={0} max={100} step={0.25} value={draft.managementFeePercent} onChange={v => set('managementFeePercent', v as number)} invalid={Boolean(errors.managementFeePercent)} suffix="%" /></div>
            </Row>
            <Row
              label="Owner approval above"
              htmlFor="mx-approval"
              error={errors.ownerApprovalThreshold}
              description={
                draft.ownerApprovalThreshold != null && draft.ownerApprovalThreshold > 0
                  ? `Work orders estimated above ${ws.money(draft.ownerApprovalThreshold, { cents: false })} prompt your team to get the owner’s approval first. Owners approve in their portal.`
                  : 'Leave empty to never prompt for owner approval. Your team can still request it on any work order.'
              }
            >
              <div data-field="ownerApprovalThreshold"><MoneyInput id="mx-approval" value={draft.ownerApprovalThreshold} onChange={v => set('ownerApprovalThreshold', v)} invalid={Boolean(errors.ownerApprovalThreshold)} placeholder="No limit" prefix={ws.money(0).replace(/[\d.,\s]/g, '') || '$'} /></div>
            </Row>
          </Group>

          <Group title="Maintenance requests">
            <Row
              label="Take requests in the portal"
              description={draft.maintenanceRequests ? 'Residents with an active lease can submit requests with photos. They arrive as New work orders.' : 'Residents are asked to call the office instead of submitting requests online.'}
            >
              <div className="flex sm:justify-end"><Switch aria-label="Take maintenance requests in the portal" checked={draft.maintenanceRequests} onCheckedChange={v => set('maintenanceRequests', v)} /></div>
            </Row>
            <Note icon={<Phone />}>
              {data.settings.emergencyPhone ? (
                <>Residents are told to call <span className="font-medium num">{data.settings.emergencyPhone}</span> for emergencies, whether or not requests are on. </>
              ) : (
                <>You haven’t set an emergency maintenance line, so residents are given your office phone for emergencies. </>
              )}
              <Link to="/settings/general" className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground">Change it in Organization</Link>
            </Note>
          </Group>
        </>
      )}
    </OrgSettingsForm>
  );
}
