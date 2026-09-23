import type { BootstrapOutputType } from 'zitejs/api';

/**
 * Types derived from endpoint schemas, so the client can never drift from
 * what the server returns. Feature areas derive their own list/detail types
 * next to their components the same way (`ListWorkOrdersOutputType[...]`).
 */

export type Bootstrap = BootstrapOutputType;
export type Me = Bootstrap['me'];
export type OrgSettings = Bootstrap['settings'];
export type Member = Bootstrap['members'][number];
export type Owner = Bootstrap['owners'][number];
export type Property = Bootstrap['properties'][number];
export type Unit = Bootstrap['units'][number];
export type Account = Bootstrap['accounts'][number];
export type Vendor = Bootstrap['vendors'][number];
export type SavedView = Bootstrap['views'][number];
export type EmailTemplateSummary = Bootstrap['templates'][number];
export type Counts = Bootstrap['counts'];
