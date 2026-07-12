---
name: perf-sanity
description: Use when changing perf-sensitive codepaths (parsing, selector/extend algorithms). Provides a lightweight sanity protocol and avoids ungrounded perf claims.
---

# Performance sanity

Use this skill when touching known perf-sensitive hotspots, especially:

- `packages/*-parser/src/**` (tokenization/productions/parsing)
- `packages/core/src/tree/util/extend.ts` (extend selector algorithm)

## Workflow

1. **State the expected perf impact**
   - Identify whether the change affects algorithmic complexity, allocations, or hot loops.
   - If unsure, say so.

2. **Prefer “sanity checks” over claims**
   - Avoid claiming perf improvements without measurement.
   - If the repo has a benchmark test, run the smallest relevant benchmark. Otherwise, prefer a targeted test run and a quick code-level reasoning note (what got faster/slower and why).

3. **Keep changes locally contained**
   - Avoid refactors that expand the surface area unless necessary for correctness.
   - Guard debug logging behind flags and keep it off by default.

4. **Watch for cross-package behavior**
   - Ensure changes don’t force downstream packages into stale `lib/` output confusion (build upstream first when needed).

