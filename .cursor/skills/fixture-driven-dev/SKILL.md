---
name: fixture-driven-dev
description: Use when working with fixture-based or golden-file tests (especially Less test-data). Helps isolate one fixture, reproduce deterministically, update expectations safely, and avoid cross-package build pitfalls.
---

# Fixture-driven development

Use this skill when a bug is reported via a fixture suite (e.g. `@less/test-data`) or when tests compare AST snapshots / rendered output.

## When to use

- You are touching `packages/jess/test/less/**` or running the Less test-data harness.
- A failure is “golden output differs” (snapshot/string output mismatch).
- You need to add a new regression fixture.

## Workflow

1. **Identify the fixture source-of-truth**
   - Find the `.less`/`.scss`/`.jess` input file path being exercised.
   - Find the expected output file or snapshot location.

2. **Isolate to one fixture**
   - Prefer the harness’s single-file option when available.
   - Otherwise isolate with `describe.only()` / `it.only()` for the single failing case.

3. **Eliminate cross-package staleness**
   - If you changed `packages/core`, build it before running `packages/jess` tests:
     - `pnpm --filter @jesscss/core build`

4. **Minimize and document**
   - If adding a regression fixture, keep it minimal (smallest input that reproduces).
   - Put a short comment in the test explaining what behavior is being protected.

5. **Update expectations deliberately**
   - Only update snapshots/expected outputs if the new behavior is intended and explained.
   - If behavior changes, add a short note in `.cursor/changes.md` (if significant).

## Anti-patterns

- Updating many snapshots at once without explaining the behavior change.
- Running large fixture suites before isolating one case.
- Forgetting the `core → jess` build nuance and chasing “ghost failures”.

