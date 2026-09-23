import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { workOrderRef } from '@project/shared/leases';
import { activityFor } from '@project/shared/server/activity';
import { threadKey } from '@project/shared/server/email';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { homeLabel, parseFiles, requestOnLease, residentFor, residentThread, residentTimeline, toResidentMessage } from '../server/resident';

/**
 * One maintenance request, as the resident sees it: status and history in
 * plain words, when someone is coming, what they said about getting in, the
 * photos, and their conversation with the office about it. No costs, no
 * internal notes, no owner approvals, only the vendor's company name.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish(), number: z.number().int().positive() });

export default createEndpoint({
  description: "One of a resident's maintenance requests",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId, number } = parseInput(Input, input, "We couldn't find that request.");
    const me = await residentFor(context, leaseId);
    const w = await requestOnLease(me.lease.id, number);
    const id = String(w.id);
    const settings = await getSettings();
    const [activity, thread] = await Promise.all([activityFor('workOrderId', id, 200), residentThread(threadKey('work_order', id), me.tenantId)]);

    const status = str(w.status) || 'New';
    const vendorName = ref(w.vendorName);
    const reportedByMe = ref(w.tenantId) === me.tenantId;
    return {
      request: {
        id,
        number: num(w.number),
        ref: workOrderRef(num(w.number)),
        title: str(w.title) || 'Maintenance request',
        description: str(w.description) ?? '',
        category: str(w.category) || 'General',
        priority: str(w.priority) || 'Normal',
        status,
        source: str(w.source) || 'Staff',
        scheduledFor: iso(w.scheduledFor),
        reportedAt: iso(w.reportedAt) ?? iso(w.created_at),
        startedAt: iso(w.startedAt),
        completedAt: iso(w.completedAt),
        permissionToEnter: w.permissionToEnter === true,
        entryNotes: str(w.entryNotes) ?? '',
        photos: parseFiles(w.photos),
        completionNotes: status === 'Completed' ? str(w.completionNotes) ?? '' : '',
        vendorName,
        tenantRating: numOrNull(w.tenantRating),
        tenantFeedback: str(w.tenantFeedback) ?? '',
        reportedByMe,
        canCancel: status === 'New',
        canRate: status === 'Completed',
      },
      home: homeLabel(me.lease),
      timeline: residentTimeline(activity, { vendorName, tenantRating: numOrNull(w.tenantRating), source: str(w.source) ?? '' }),
      messages: thread.map(r => toResidentMessage(r, settings.organizationName)),
      organizationName: settings.organizationName,
      emergencyPhone: settings.emergencyPhone || settings.phone,
    };
  },
});
