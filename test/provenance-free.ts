/**
 * Strip inline source provenance from an AST value for structural assertions.
 *
 * Provenance rides on nodes as inline integer slots (`_s`/`_e` source span,
 * `_bs`/`_be` body span, `_trivia` document trivia — see
 * `packages/core/src/ast/provenance.ts`). It is deliberately ORTHOGONAL to the
 * semantic AST: the same grammar fact means the same thing whatever byte offsets
 * produced it, and two sources differing only in whitespace produce identical
 * facts at different offsets.
 *
 * A structural `toEqual` describes that semantic shape, so wrap the ACTUAL value
 * in `bare(...)` rather than spelling byte offsets into the expectation. Tests
 * that mean to assert a span read it directly through `sourceSpanOf` /
 * `bodySpanOf` (see `packages/core/src/ast/__tests__/provenance.test.ts`).
 */
const PROVENANCE_SLOTS = new Set(['_s', '_e', '_bs', '_be', '_trivia']);

export function bare(value: unknown): unknown {
  return strip(value);
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(strip);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PROVENANCE_SLOTS.has(key)) {
      continue;
    }
    out[key] = strip(entry);
  }
  return out;
}
