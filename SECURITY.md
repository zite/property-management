# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's advisory form](https://github.com/zite/property-management/security/advisories/new),
or email **security@zite.com**. We will acknowledge within three working days and
keep you updated until it is resolved. If you would like credit in the advisory,
say so and we will include you.

## Scope

This repository is a **template**. It is installed into a workspace that you run,
so a report against it is about the application code here: endpoint
authorization, data exposure between people or organizations, injection through
user-supplied content, that kind of thing.

Vulnerabilities in the **Zite platform itself** (auth, the endpoint runtime,
hosting) go to security@zite.com too, but say which you mean.

## What we already know and treat as by design

- The demo data is public sample content: fictional properties, residents and
  owners.
- The Resident Portal is one external app serving residents, applicants, owners
  and vendors. Identity comes only from the verified email on the session, and
  every portal query is scoped by it. "Missing" and "not yours" both return
  NOT_FOUND on purpose.
- Staff roles (Admin, Property manager, Leasing, Maintenance, Accountant) are
  enforced in endpoints, not only in the UI.

## Supported versions

This is a template rather than a released library. Fixes land on `main` and you
pick them up by merging. There are no maintained release branches.
