# Contributing

Thanks for taking the time. This is a **Zite solution** (a database plus 2 apps), so
contributing to it is a little different from a library, and mostly easier.

## What we're looking for

- **Bug fixes**, especially in the ledger, statements, lease lifecycle or reports SQL.
- **Report columns, filters and charge types.** Additive work that fits the existing
  shapes.
- **Accessibility and keyboard** fixes. These tools are meant to be usable
  without a mouse; anywhere they are not is a bug.
- **Copy and clarity.** This template is read by people who just installed it. If
  a label or empty state confused you, it will confuse them.

Please open an issue before a large change, so we can agree the shape first.

## Getting a workspace to develop against

Endpoints in `src/api/` run on Zite's runtime, not on your machine, so you need a
workspace of your own before the app will load data. Install the template into one
by following [Install it in your own workspace](README.md#install-it-in-your-own-workspace).
It takes a few minutes and gives you the demo data to work against.

Then:

```bash
yarn install
cp .env.example .env.local   # put your workspace id in ZITE_BASE_ID
yarn dev
```

The frontend hot-reloads locally. **Endpoint changes only take effect once they are
deployed to your workspace.** Edit them in a Zite sandbox and `commit`, or push and
pull them in. This catches everyone once.

## Before you open a pull request

```bash
yarn generate    # only if you added, renamed or deleted an endpoint
yarn run check   # tsc + endpoint bundling + vite build
```

`zitejs check` reports `bundle endpoints ✗` with no error on an app this size. That
is a 1 MB stdout buffer in the checker, not your change. The `tsc` and `vite build`
lines are the ones that matter. For real endpoint errors:

```bash
npx zitejs bundle --app property-management > /tmp/b.json   # read endpointErrors
```

**A clean type-check is not proof.** SQL identifier mistakes and bad joins only
surface at runtime, because `zite.sql()` takes strings. Exercise the endpoints you
touched against a real workspace and check the logs before calling it done.

## House rules for the code

These are load-bearing. See
[Decisions worth knowing](README.md#decisions-worth-knowing-before-extending-it)
for the why.

- **Never trust an id for who is acting.** Endpoints resolve the actor from the
  session, never from an id in the request.
- **Re-validate input on the server.** Zite does not enforce an endpoint's
  `inputSchema`.
- **No `zod` in `packages/shared`.** The root has zod 4 and endpoints use the app's
  zod 3; importing it there breaks one of them.
- **Foreign keys are text.** Cast the uuid side in joins
  (`a.id::text = b."aId"`), and remember unset text is `''`, never `NULL`, so
  `IS NULL` matches nothing.
- **Write in small batches.** The live database rejects write bursts.
- **Match the surrounding style.** No formatter is enforced; the existing code is
  the spec.

## Licence

By contributing you agree your work is licensed under the [MIT Licence](LICENSE).
