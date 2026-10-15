/*
 * A golden known to lag a fix, with the exact edit the owner has been asked to make,
 * each citing the ruling that decides it. The fixture keeps its full byte gate against
 * the edited golden. Each `from` must occur exactly once in the golden, so the entry
 * fails — and must be removed — once the owner applies the edit. Every test that reads
 * a Less fixture's golden (`all-less.test.ts`, `extend-exact-oracle.test.ts`,
 * `strict-units.test.ts`, `operations-placement.test.ts`) applies these same edits.
 *
 * An edit no ruling decides yet is NOT applied: the harness would assert it as if the
 * owner had accepted it. Such an edit is listed here, in a comment, and its fixture is
 * an expected failure in `all-less.test.ts` until the owner decides. Awaiting the owner:
 *
 * - `tests-unit/parse-interpolation/parse-interpolation.less`: a `*[…]` capture's
 *   header branches one per line, `  .d:is(.a, .b, .c)&:hover, baz-cap {` →
 *   `  .d:is(.a, .b, .c)&:hover,\n  baz-cap {` (O8(a), an owner-delegated judgment of
 *   2026-10-04); and the quoted case's `foo: bar` → `foo: baz`, which the source
 *   writes (a golden typo).
 * - `tests-unit/functions/functions.less`: `  length-1: 1;` → `  length-1: 3;`, a
 *   `$name` accessor reading `~(1, 2, 3)` as the three-item list (ledger V26, OPEN).
 */
const pendingGoldenEdits = new Map<string, ReadonlyArray<readonly [from: string, to: string]>>();

export function applyPendingGoldenEdits(file: string, golden: string): string {
  let edited = golden;
  for (const [from, to] of pendingGoldenEdits.get(file) ?? []) {
    const at = edited.indexOf(from);
    if (at === -1 || edited.indexOf(from, at + 1) !== -1) {
      throw new Error(`${file}: the pending golden edit no longer applies; remove its pendingGoldenEdits entry`);
    }
    edited = edited.slice(0, at) + to + edited.slice(at + from.length);
  }
  return edited;
}
