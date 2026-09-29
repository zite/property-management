# Property Management: build brief for contributors

This is a complete property management system built as a Zite template: a
working alternative to AppFolio, Buildium and DoorLoop for a small-to-mid
property management company. The bar is **Linear-level UX**: fast, dense,
keyboard-first, optimistic, beautiful in light and dark, and with nothing that
looks finished but doesn't work.

Read this whole file before writing code. Then read the files it points at.

---

## 1. The product

Two apps share one database (`zite.schema.json`, 30 tables):

| App | Who | Access |
| --- | --- | --- |
| **Property Management** `apps/property-management` | Staff: admins, property managers, leasing agents, maintenance, accountants | Internal |
| **Resident Portal** `apps/resident-portal` | Residents, applicants, owners, vendors | External, sign-in |

Demo company (loaded by an Admin from the bottom of Settings → Organization, only
into an empty workspace; nothing loads it on its own): **Cedar & Main Property
Management**, Denver. 6 properties, 35 units, 4 owners, 32 active leases + 1
pending + 4 ended, 8 months of books, 32 work orders, 14 vendors, listings,
inquiries, applications, messages, tasks, documents, inspections. The admin
who loads it (in the harness: `dominic@fillout.com`) is linked in as the
resident of **The Alder 201**, the owner of **48 Cottonwood Lane**, and the
contact for vendor **Summit Appliance Repair**, so every portal area has data.

Seed code: `apps/property-management/src/seed/*`, `apps/property-management/src/api/seedWorkspace.ts`.
Who may load it, and what counts as the workspace's own content, is in
`apps/property-management/src/server/sampleData.ts`; removal is `src/api/clearDemoData.ts`.
A fresh install needs no seed to work: bootstrap creates the Settings row, the first
Admin, the chart of accounts and the email templates.

---

## 2. What runs where, and the local harness

- Frontend: Vite locally. Endpoints (`src/api/*.ts`): Zite's cloud in production.
- **Locally you run everything on the review harness**: real endpoints executed
  in Vite middleware against an in-memory Postgres (PGlite) that mimics Zite's
  quirks. Config: `apps/<app>/vite.review.config.ts` (gitignored).
- Harness files: `/private/tmp/claude-501/-Users-dominicwhyte-dev-zite-solutions/3aaaa919-6f61-4fcd-b2ac-e8bacff54f62/scratchpad/harness/` (call it `$H`).

Start your own server on **your assigned port** (never another agent's):

```bash
cd apps/property-management            # or apps/resident-portal
REVIEW_PORT=<your port> npx vite --config vite.review.config.ts > $H/<you>-vite.log 2>&1   # run_in_background: true
PORT=<your port> $H/reseed.sh      # seeds the demo (portal harness falls back to the staff app's seed endpoint)
```

The DB is in memory: restarting the server resets it (reseed). Signed-in user
is the `review_user` cookie (default `dominic@fillout.com`, an Admin). Test as
someone else: set `review_user=renata.ortiz@example.com` (Property Manager),
`theo.nakamura@example.com` (Leasing Agent), `luis.fernandez@example.com`
(Maintenance), `grace.adeyemi@example.com` (Accountant), a resident like
`maya.chen@example.com`, or `anon` (signed out, portal only).

Call endpoints directly: `curl -s -X POST http://127.0.0.1:<port>/api/<name> -H 'content-type: application/json' -d '{"inputs":{...}}'`.
Ad-hoc SQL against the harness DB: write queries to a file as `-- name` sections
and run `PORT=<port> python3 $H/q.py file.sql` (uses a local-only `zzDebug`
endpoint, never reference it from app code).

Drive the UI with trusted input over CDP: `node $H/cdp.mjs steps.json --port <your cdp port>`
(steps: go/wait/waitFor/waitText/click/clickText/type/key/eval/shot/viewport/dark/cookie;
see the header of `cdp.mjs`). Use a DIFFERENT `--port` from other agents (your
assigned port + 1000). Screenshots go in `$H/shots/<you>/`. Look at them.

Traps (all real): `Page.navigate` to the same `#/route` is a no-op; use
`eval: location.reload()`; Enter keyDown needs `text: '\r'`; headless clicks
don't focus buttons; React inputs need trusted typing; read the DOM after a tick.

After adding/renaming an endpoint file run `npx zitejs generate` **from the repo
root** (`/Users/dominicwhyte/dev/zite-solutions/property-management`). Type-check your app
with `npx tsc --noEmit -p apps/<app>/tsconfig.app.json`. Don't run `yarn check`
(the full build); CI runs that.

---

## 3. Data and SQL rules (runtime failures a type-check can't see)

- Tables: SDK accessor camelCase (`zite.workOrders`), SQL PascalCase quoted (`"WorkOrders"`). Fields camelCase quoted (`"propertyId"`). System columns `id`, `created_at` unquoted. Read `.zite/db.ts` for exact names.
- **Foreign keys are text columns** holding record ids. Join with the uuid side cast: `p.id::text = w."propertyId"`, never `w."propertyId"::uuid`.
- **Unset text is `''`, never NULL**: "no vendor" is `COALESCE(w."vendorId", '') = ''`. Dates, numbers and checkboxes ARE null when unset (`COALESCE("archived", false)`).
- `zite.sql` returns numbers/COUNT/SUM as **strings** → `num()`; date fields as ISO timestamps → `day()`; datetimes → `iso()`; selects as labels. Helpers in `packages/shared/server/sql.ts` (`str`, `ref`, `num`, `numOrNull`, `day`, `iso`, `bool`, `json`, `Params`, `chunked`).
- `findAll` ignores `sort` and caps at 500/2000: order and aggregate in SQL. `zite.sql` caps at 2000 rows, so paginate or aggregate.
- **Never name a CTE after a table** (`WITH tasks AS` breaks `"Tasks"` live). Use `task_counts`, `ranked`.
- Always bind values with `params` (`$1`), never interpolate user input. Build clauses from closed sets.
- `bulkCreate` ≤ 100 records (use `chunked`). A filter value of `undefined` throws.
- Single-select values must be one of the options in `packages/shared/constants.ts` (mirrors the DB). A new option has to be added to the live schema before code can use it.
- Money: never add dollars as floats. `packages/shared/money.ts` (`toCents`, `fromCents`, `sumMoney`, `formatMoney`). Dates: `packages/shared/dates.ts` (day strings, `todayIn(timezone)`, `addMonths`, periods).

## 4. Server rules

- **Zite does not enforce `inputSchema`.** Re-parse: staff app endpoints use `parseInput(schema, input)` from `apps/property-management/src/server/input.ts`; portal endpoints use `parseInput` from `apps/resident-portal/src/server/identity.ts`. Throw `new ZiteError('A sentence a person can read.', 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT')`.
- **Staff identity** comes only from the session: `const actor = await getActor(context)` then `assertCan(actor, '<capability>')` (`packages/shared/roles.ts` has the matrix). Never trust an actor id from input.
- **Portal identity** comes only from the verified email: `requireResident(context, leaseId?)`, `requireOwner`, `requireVendor`, `requireOwnApplication` in `apps/resident-portal/src/server/identity.ts`. Every portal query must be scoped by what those return. "Missing" and "not yours" are the same NOT_FOUND. Portal endpoints never return staff-only fields (internal notes, owner approval notes to residents, other tenants' data, vendor costs to residents).
- **Money only moves through the posting engine** `packages/shared/server/ledger.ts`: `postCharge`, `receivePayment`, `postCredit`, `refundCredit`, `applyDeposit`, `refundDeposit`, `postBill`, `payBills`, `postExpense`, `postOwnerMoney`, `postManagementFee`, `postTransfer`, `postJournalEntry`, `voidTransaction`; reads: `leaseBalances`, `leaseLedger`, `openCharges`, `openBills`, `bankBalances`, `propertyCash`, `collectedIncome`. **Never** write `Transactions`, `JournalLines` or `Allocations` directly. The header comment in `ledger.ts` explains every entry. Accounts are found by `systemKey` via `getChart()` (`server/accounts.ts`).
- Leases: `packages/shared/server/leases.ts` provides `createLease`, `activateLease`, `postRecurringCharges`, `recordSignature`, `acceptRenewal` / `declineRenewal` (a renewal extends the SAME lease), `giveNotice`, `refreshLeaseName`, `upsertTenant`, `overlappingLeases`. Derived lease phase and unit occupancy: `packages/shared/leases.ts` (`leasePhase`, `unitOccupancy`, refs `L-1042` / `WO-1042` / `APP-201`).
- Audit: every meaningful change writes `logActivity({...})` (`server/activity.ts`) with a finished `summary` fragment ("moved WO-1042 to Scheduled"). Timelines read `activityFor(column, id)`.
- Inbox: `notify({ recipientIds, kind, title, body, link: '/work-orders/1042', entityType, entityId, actorId })` (`server/notify.ts`). Never notify the actor. `link` is a staff-app hash route.
- Email + conversations: `messagePerson(...)` writes a `Messages` row and optionally emails; `sendTriggered({ trigger, recipient, context })` sends the org's template if enabled; `leaseRecipients(leaseId)`; `threadKey('tenant'|'owner'|'vendor'|'applicant'|'work_order', id)`. Merge tags: `packages/shared/merge.ts`. Default templates: `packages/shared/templates.ts`. Settings: `getSettings()`, `portalLink`, `staffLink`.
- Tasks created by the system: `ensureTask({ systemKey, ... })` in `server/automation.ts` (idempotent).
- Numbers: `nextNumber('WorkOrders' | 'Leases' | 'Applications' | 'Transactions', start)`.
- Files: frontend `uploadFile({ data, filename })` from `zitejs/upload` → `fileUrl`; store in `Documents` or JSON photo arrays `[{ url, name }]`. PDFs: `import { Pdf } from 'zitejs/pdf'` → `await Pdf.renderHtml({ html, filename })` → `{ url }` (server only).
- AI (staff app only, optional): `ZITE_ANTHROPIC_ACCESS_TOKEN`; hand-written JSON schema with `client.messages.parse({ ..., output_config: { effort: 'low', format: { type: 'json_schema', schema } } })`, with no `name` key and no zod helper. Model `claude-opus-5`. Always ship a non-AI path and hide AI buttons when `integrations.ai` is false. Never use AI to decide on applicants (fair housing).
- Scheduled endpoints: `schedule: { scheduleType: 'recurring', schedule: { frequency: 'daily', interval: 1, times: ['06:00'] }, timezone: 'America/Denver' }`; `context.user` is null on scheduled runs.
- **Do not import `zod` from `packages/shared`** (root zod is v4; apps use zod 3).

## 5. Frontend rules (both apps)

- Data: `@tanstack/react-query`. Callers from `zitejs/api`. Keys: each area owns a first/second segment (see the `qk` comment in the app's `lib/queries.ts`); invalidate by prefix after writes. Frequent actions (status changes, toggles, drags, assignments) are **optimistic** with rollback + toast on failure.
- Errors: `errorMessage(e, 'Fallback sentence')` from `lib/errors.ts` → `toast.error(...)`.
- Never a spinner for page loads; use skeletons shaped like the content. Every list has a designed empty state and a filtered-empty state ("Nothing matches, clear filters").
- Every destructive action confirms, and says what will happen. Prefer undo toasts where cheap.
- Light and dark must both look intentional. Use tokens (`text-muted-foreground`, `bg-accent`, `border`, `tone-*` for semantic colour: `text-tone-danger`, `bg-tone-success/10`). Never raw Tailwind palette shades for text (fail contrast in one theme).
- Responsive to 390px. Tables scroll horizontally inside their container; the page never does.
- Copy: plain, specific, human. Sentence case. No "Successfully", no exclamation marks in errors. Money always formatted with `formatMoney`; dates via the app's `lib/format.ts`.
- The build transform can't parse generic JSX type arguments (`<Picker<string> …>`): let inference do it.
- Relative imports for your own files (`../components/…`). `@project/components/ui/*` for shadcn primitives.

### Staff app (apps/property-management)
See **§8 Staff UI kit**. Linear-dense: 13px base, 40px rows, `rounded-md` controls, one primary button per page header.

### Portal (apps/resident-portal)
- Consumer-grade, calm, 15px base, 40–48px touch targets, `rounded-xl` cards. Kit: `src/components/ui.tsx` (`Button`, `LinkButton`, `Card`, `Container`, `SectionHeading`, `StatusPill` with `Tone`, `Alert`, `EmptyState`, `PageSkeleton`, `FieldRow`, `inputClass`, `textareaClass`, `BackLink`, `PropertyGlyph`, `ProgressBar`, `Tip`), `ConfirmDialog.tsx`, `SignInPrompt.tsx`, `Layout.tsx` (header nav per area; the URL decides the area), `lib/format.ts`, `lib/upload.ts` (`uploadPortalFile`), `lib/queries.ts` (`usePortal`, `useMe`, `currentLease`, `retry`, `qk`), `lib/auth.tsx` (`useSession().signIn(hashPath)`).
- The brand colour is the organization's (`useBrand`), used for ONE primary action per page, links and focus rings. `variant="ink"` for secondary emphasis.
- Every page sets `useDocumentTitle('…')`. Pages are lazy-loaded from `App.tsx`; routes are fixed, so say so in the pull request if you need a new one.
- `Me` (from `getPortalMe`) has `resident` (leases, balance, counts), `owner`, `vendor`, `applicant`. Routes under `/resident`, `/owner`, `/vendor` are already gated by `RequireArea`.

## 6. Quality bar: check every item before you report done

- [ ] Every button does something real, end to end, verified on the harness (endpoint called, DB changed, UI updated, toast shown).
- [ ] Loading skeleton, empty state, filtered-empty state, error state with retry.
- [ ] Keyboard: Tab order sane, Enter submits forms, Esc closes dialogs, focus returns to the trigger. (Staff app: list shortcuts per §8.)
- [ ] Optimistic updates for frequent actions; no double-submit (disable while pending).
- [ ] Long content: 60-character names, 5-line descriptions, $1,234,567.89 amounts, zero items, 200 items.
- [ ] Light, dark, and 390px wide screenshots reviewed by eye.
- [ ] Permissions: try the flow as a role that shouldn't be allowed (staff) / as another resident (portal), the server refuses with a clear message.
- [ ] No console errors. No `any` leaks into rendered text ("undefined", "NaN", "[object Object]").
- [ ] Copy reviewed: specific, human, consistent with the rest of the app.

## 7. Adding an area

New endpoint files are fine; names must be unique and specific
(`listLeaseCharges`, not `list`). Check `apps/<app>/src/api/` for collisions
first, and run `npx zitejs generate` from the repo root afterwards.

If you need a change in shared code (a bug in a shared component, a new shared
helper, a new route, a new select option), say so in the pull request rather
than working around it locally, so the fix lands once. A new select option has
to be added to the live database before code can use it.

## 8. Staff UI kit (apps/property-management): use it, don't rebuild it

**Look at the reference implementation first**: Work Orders
(`src/components/workOrders/*`, `src/pages/WorkOrdersPage.tsx`,
`src/pages/WorkOrderPage.tsx`, endpoints `listWorkOrders`, `getWorkOrder`,
`createWorkOrder`, `updateWorkOrders`, `addWorkOrderComment`, `workOrderMoney`).
Open `/#/work-orders` and
match its density, keyboard model, empty states and copy. Every list page and
record page in the staff app should feel like the same product.

### Shell and app-wide actions
- `useAppActions()` (`lib/app-actions.tsx`): `confirm({ title, description, confirmLabel, destructive }) → Promise<boolean>`,
  `openCreate(kind, defaults)` (kinds: workOrder, task, lease, property, unit, owner, vendor, tenant, inquiry, listing, bill, payment, charge, credit, announcement, inspection),
  `openCompose({ recipients: [{ kind, id, name, email }], subject, body, context: { leaseId, workOrderId, propertyId, applicationId } })`, `peekWorkOrder(number)`, `openPalette()`.
- Create dialogs are registered in `components/shell/CreateDialogs.tsx` → one file per kind in its area folder, default export `({ open, onOpenChange, defaults })`. Contract: reset state when `open` turns true; document the `defaults` keys you read in the file's top comment; inline field errors; on success `toast.success('…', { action: { label: 'Open', onClick } })`, invalidate the query roots you changed, close.
- `useWorkspace()` (`lib/workspace.tsx`): bootstrap data indexed, `me`, `role`, `can(capability)`, `isAdmin`, `today`, `settings`, `integrations`, `counts`, `members/activeMembers/memberById`, `owners/ownerById`, `properties/propertyById/orderedProperties`, `units/unitById/unitsByProperty` (with live `occupancy`, `currentLeaseId`, `residentNames`, `currentRent`, `leaseEnd`), `vendors/vendorById/activeVendors`, `accounts/accountById/accountByKey(systemKey)/bankAccounts/chargeAccounts/expenseAccounts`, `views/viewById`, `templates`, and helpers `money(n, { cents, compact, sign })`, `unitLabel(unitId, propertyId)` ("The Alder · 204"), `propertyName(id)`, `memberName(id)`. Types in `lib/types.ts`. After a write that changes any of this (a property, unit, member, vendor, account, view, a sidebar count), `invalidate(qc, 'bootstrap')`.
- Query keys: `qk` in `lib/queries.ts`; `invalidate(qc, ...roots)`; `invalidateMoney(qc)` after anything that posts money; `retryUnlessNotFound` for detail queries.

### Page anatomy
- **Every page** starts with `<PageHeader icon title breadcrumb? tabs? actions? />` (`components/shell/PageHeader.tsx`) and calls `useDocumentTitle('…')`. Header tabs are `[{ to, label, count?, active? }]`, route or `?tab=` based. The page's primary action is a small primary button in `actions` with its `Kbd` hint if it has a shortcut.
- **List pages**: header + a list surface that fills `flex-1` (the list scrolls, not the page).
- **Record pages**: `<DetailLayout header rail>` (`components/detail/DetailLayout.tsx`), main column (max 860px, or `wide`) + a 300px properties rail using `RailSection` / `RailRow` with ghost-chip triggers that open pickers in place. `SectionHeading` for main-column sections, `InlineTabs` for record sub-views (sync the tab to the URL `/:id/:tab`). History: `<Timeline activity messages />` + `<Composer modes onSend />` (`components/detail/Timeline.tsx`). Files: `<DocumentsPanel scope="leaseId" id={id} links={{ leaseId: id, propertyId, unitId }} showSharing={{ tenant: true }} />` (`components/detail/DocumentsPanel.tsx`; scopes `propertyId|unitId|leaseId|tenantId|ownerId|vendorId|workOrderId|applicationId`; endpoints `listDocuments`/`saveDocument`).

### Lists (copy `WorkOrdersView.tsx`)
- `useListState(surfaceKey, defaultOptions, defaultFilters)` (`lib/listState.ts`): layout/grouping/ordering/properties/showClosed + filters, remembered per surface; `isDirty`, `reset`.
- `useListNav({ items, getId, onOpen, onPeek, enabled })` (`components/list/useListNav.ts`): J/K/↑/↓ focus, ⇧J/⇧K extend, X select, ⌘A all, Enter open, Space peek, Esc clear; `onRowClick`, `toggleSelect`, `targets()` (selection or focused), `targetsFor(row)`, `scrollRef` (put it on the scrolling div). Disable (`enabled: false`) while a picker/dialog of yours is open.
- `ListToolbar` (`components/list/Toolbar.tsx`): `start` (filters), `count`/`countLabel`, `search`/`onSearch` (`/` focuses), `layout`/`layouts`/`onLayout`, `display` (`DisplayMenu` with groupings, orderings, display properties, closed toggle), `more` (DropdownMenuItems: Export CSV, Save as view…).
- Filters (`components/list/Filters.tsx`): describe them as data with `listFilter(field, label, icon, options)` / `singleFilter(...)`; render `<FilterMenu defs filters onChange/>` + `<FilterChips …/>`.
- Rendering: `GroupedList` (sticky collapsible groups, `useCollapsedGroups`) with rows built on `RowShell` (40px, hover checkbox, focus bar, context menu via `menu`) and `Slot` (a plain button that mounts its picker only when clicked, never mount a popover per row). `Board` + `BoardCard` for kanban (optimistic `onMove`). `DataTable` for ledgers/rent rolls/reports (`columns: [{ key, header, cell, sort?, align: 'right' for money, width, hideBelow, footer }]`, optional selection/focus).
- Bulk: `<BulkBar count noun onClear>` with `bulkButton`-styled triggers.
- Saved views: `<SaveViewDialog scope config existing/>` + `parseViewConfig`; scopes `work_orders | leases | residents | applications | tasks | units` (endpoint `saveView`). A saved view renders at `/views/:id` through the registry in `pages/ViewPage.tsx`.
- CSV: `downloadCsv(name, headers, rows)` (`lib/csv.ts`). Clipboard: `copyText(text, message)` (it toasts).

### Forms and pickers
- `FormDialog` (`components/form/FormDialog.tsx`): `open onOpenChange title description onSubmit pending submitLabel size('sm'|'md'|'lg'|'xl') footerStart destructive`. ⌘↵ submits, first field focused, focus returns.
- Fields (`components/form/fields.tsx`): `Field(label, hint, error, optional, action)`, `FieldRow(cols)`, `TextInput`, `TextArea`, `MoneyInput` (number|null), `NumberInput(suffix)`, `DateInput` ('YYYY-MM-DD'), `DateTimeInput` (ISO), `SwitchRow(label, description)`, `Segmented(options)`.
- Pickers (`components/pickers/pickers.tsx`): `FieldButton` (form-field trigger with `icon`, `placeholder`, `onClear`), `MemberPicker`, `PropertyPicker`, `UnitPicker(propertyId, onlyVacant)`, `VendorPicker(trade)`, `AccountPicker(kind: charge|expense|bank|income|all)`, `ChoicePicker(options)`, `RecordSearchPicker(kinds: tenants|leases|owners|vendors|applications)` (server search), and the generic `OptionPicker` (`components/pickers/OptionPicker.tsx`: options `{ value, label, icon, hint, group, keywords, shortcut }`, single or `multiple`).
- Remember: no generic JSX type arguments (`<Segmented<Filter> …>` breaks the Zite build), cast in the handler: `onChange={v => setFilter(v as Filter)}`.

### Primitives
- `components/primitives/bits.tsx`: `Kbd`, `Keys`, `Tip(label, keys)`, `EmptyState(icon, title, description, action)`, `IconButton`, `SkeletonRows`, `SectionLabel`, `ProgressBar`, `ProgressRing`.
- `components/primitives/Avatar.tsx`: `Avatar`, `MemberAvatar`, `UnassignedAvatar`, `AvatarStack`.
- `components/primitives/glyphs.tsx`: `WorkOrderStatusGlyph`, `PriorityGlyph`, `OccupancyGlyph`, `Pill(tone, dot)`, `LeasePhasePill`, `LEASE_PHASE_TONE`, `ApplicationStatusGlyph`, `APPLICATION_TONE`, `TaskStatusGlyph`, `PropertySwatch`.
- `components/primitives/data.tsx`: `Money(value, tone: plain|balance|flow, muted0, compact, cents, signed)`, **every amount renders through it**; `StatTile`, `Facts`, `PropertyLabel(propertyId, unitId)`, `Figure`, `Card(title, action)`.
- CSS classes (`src/index.css`): `.field`, `.ghost-chip`, `.chip`, `.kbd`, `.num` (tabular), `.skeleton`, `.prose-ks`; surfaces `bg-canvas`, `bg-subtle`, `text-faint`; semantic `tone-{info,accent,success,warning,danger}`.
- `lib/format.ts`: `shortDate`, `fullDate`, `longDate`, `dateTime`, `shortDateTime`, `timeAgo`, `dueLabel`, `relativeDays`, `daysFromToday`, `plural`, `percent`, `bedsBaths`, `initials`, `appUrl`, `telHref`, `todayString`, `addDays`.
- `lib/hotkeys.ts`: `useHotkeys(map, { enabled, allowInOverlay })`, `MOD`.

### Already built: reuse, don't duplicate
- **Work orders anywhere**: `<WorkOrdersView surfaceKey="property:<id>:work-orders" baseFilters={{ propertyIds: [id] }} lockedFilters={['propertyIds']} createDefaults={{ propertyId: id }} />` (also `unitIds`, `vendorIds`, `leaseId`, `tenantId`, `scheduleId`, `hideLocation`, `defaults`). New work order: `openCreate('workOrder', { propertyId, unitId, tenantId, vendorId, title, description, category, priority, source })`.
- **Money on a lease**: `<LeaseLedger leaseId={id} />` (`components/accounting/LeaseLedger.tsx`), balance/past due/deposit summary, entries with running balance, void, waive, deposit apply/return, credit refund, CSV. `useLeaseLedger(leaseId)` + `afterPosting(qc)` (`components/accounting/ledgerData.ts`). Dialogs: `openCreate('payment' | 'charge' | 'credit', { leaseId, amount, description, accountId, chargeId, tenantId })`; `DepositDialog`, `VoidDialog` (any transaction id) in `components/accounting/LedgerDialogs.tsx`. Endpoints: `getLeaseLedger`, `postLeaseMoney`, `voidLedgerTransaction`.
- **Search** endpoint `search({ query, kinds, limit })` for pickers and the palette.

### Keyboard conventions
Global (don't rebind): `⌘K` palette, `C` new work order, `⇧P` receive payment, `⇧H` new charge, `G` then a letter to navigate, `?` shortcuts, `[` sidebar, `/` search the current list, `⌘↵` submit. Lists: J/K, X, ⌘A, Enter, Space, Esc. Property shortcuts on list rows and record pages follow the work-order model (`S` status, `P` priority, `A` assign, `D` due, `I` assign to me), reuse those letters for the equivalent property in your area; add any new shortcuts to `ShortcutsDialog` in the same change.

### Permissions in the UI
Hide actions a role can't take (`ws.can('payables.manage')`); pages are already gated in `App.tsx` by capability. The server is the authority, every endpoint calls `assertCan`.
