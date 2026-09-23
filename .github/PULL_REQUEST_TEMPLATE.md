## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- What was wrong, or what this makes possible. -->

## How it was verified

<!-- A clean type-check is not proof: SQL identifier mistakes and bad joins only
     surface at runtime. Say which endpoints or screens you actually exercised,
     and against what data. -->

- [ ] `yarn run check`, with the `tsc` and `vite build` lines clean
- [ ] `yarn generate` run (if an endpoint was added, renamed or deleted)
- [ ] Exercised against a real workspace, not just a type-check
- [ ] Checked the screens this touches at phone width, in light and dark

## Anything reviewers should look at closely

<!-- Trade-offs you made, things you were not sure about, follow-ups you left. -->
