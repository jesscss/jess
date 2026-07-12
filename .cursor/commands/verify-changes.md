# Verify Changes

Run a minimal verification matrix after making code changes. Keep it **package-scoped** and avoid over-testing before isolating failures.

## Workflow

1. **Identify touched package(s)**
   - Determine which workspace package(s) were edited.

2. **Build upstream when needed**
   - If downstream tests import a workspace dependency via `lib/`, build the dependency first.
   - Example: after changing `packages/core`, run:
     - `pnpm --filter @jesscss/core build`

3. **Run the smallest relevant test command**
   - Prefer running tests from the package directory or with `pnpm --filter`.
   - If debugging, isolate with `.only` and remove it afterward.

4. **If failures occur**
   - Switch to systematic debugging: observe → hypothesize → trace → verify → fix.
   - Update `.cursor/PROJECT_STATE.md` if this becomes an ongoing debugging focus.

