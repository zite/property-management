import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { day, iso, num, numOrNull, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { ownerScope } from '../server/owner';

/**
 * Documents the office has shared with this owner: ones filed against the
 * owner (management agreements), their properties (insurance, warranties) or
 * repairs on them (quotes, invoices). Only what's marked shared with the owner.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'Documents shared with the owner',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await ownerScope(context);
    const { ownerId, propertyIds } = scope;
    const { rows } = await zite.sql({
      query: `
        SELECT d.id, d."name", d."url", d."category", d."propertyId", d."ownerId", d."size", d."mimeType", d."expiresOn", d."uploadedAt", d.created_at,
          p."name" AS "propertyName", w."number" AS "workOrderNumber", w."title" AS "workOrderTitle"
        FROM "Documents" d
        LEFT JOIN "WorkOrders" w ON w.id::text = d."workOrderId"
        LEFT JOIN "Properties" p ON p.id::text = COALESCE(NULLIF(d."propertyId", ''), w."propertyId")
        WHERE COALESCE(d."sharedWithOwner", false) = true AND COALESCE(d."url", '') <> ''
          AND (d."ownerId" = $1 OR d."propertyId" = ANY($2) OR w."propertyId" = ANY($2))
          AND (COALESCE(d."ownerId", '') = '' OR d."ownerId" = $1)
        ORDER BY COALESCE(d."uploadedAt", d.created_at) DESC
        LIMIT 500`,
      params: [ownerId, propertyIds],
    });
    return {
      documents: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) || 'Document',
        url: str(r.url) ?? '',
        category: str(r.category) || 'Other',
        propertyId: propertyIds.includes(String(r.propertyId)) ? String(r.propertyId) : null,
        propertyName: str(r.propertyName) ?? '',
        workOrderNumber: numOrNull(r.workOrderNumber),
        workOrderTitle: str(r.workOrderTitle) ?? '',
        size: numOrNull(r.size),
        mimeType: str(r.mimeType) ?? '',
        expiresOn: day(r.expiresOn),
        uploadedAt: iso(r.uploadedAt) ?? iso(r.created_at),
      })),
      properties: propertyIds.length
        ? (await zite.sql({ query: `SELECT id, "name" FROM "Properties" WHERE id::text = ANY($1) ORDER BY "name"`, params: [propertyIds] })).rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '' }))
        : [],
      total: num(rows.length),
    };
  },
});
