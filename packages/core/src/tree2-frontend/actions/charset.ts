/**
 * [tree2-native] Charset / raw at-STATEMENT family (F16): `@charset "…";` and any
 * statement-form at-rule with no block (`@namespace svg "…";`, `@layer a, b;`, …)
 * → tree2 `AtRuleStatement`.
 *
 * The parseman grammar builds the generic `AtRuleStatement`
 * (`sequence(atKeyword, atPrelude, ';')`) AND the committed `@import` statement
 * under the SAME `node('AtRuleStatement', …)` type. For the GENERIC case the
 * grammar tokenizes the head into SEPARATE children — the `atKeyword` leaf
 * (`@charset`), the optional `atPrelude` leaf, and the terminating `;` leaf — so
 * this action CONSUMES those children directly and never re-tokenizes the raw span
 * (P0: the parser is the sole source of structure).
 *
 * The `@import` production shares this type but structures its prelude differently
 * (a `Quoted`/`Url` value node + optional `(options)` paren + media leaf, NOT a
 * single `atPrelude` leaf). A dedicated import family should consume those
 * structured children; until it exists (TODO(tier-b)), the import shape falls back
 * to recovering the prelude bytes between the keyword leaf and the `;` leaf — a
 * span the parser DID structure at both ends. import-bridge owns import RESOLUTION;
 * this node only carries the unresolved head.
 *
 * The v5 hoist-first / dedupe-rest `@charset` semantics live entirely in the
 * serializer (`emitHoistedCharset`); this family only BUILDS the node.
 *
 * Boundary: touches `../../tree2` only, never the legacy `../tree`. TOTAL — a
 * backtracked branch whose leading child is not a real `@keyword` returns an inert
 * placeholder rather than throwing.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, type BuildArgs, type Placeholder, type Span, placeholder } from '../host-context.js';

interface Leaf {
  readonly _tag?: string;
  readonly value?: unknown;
  readonly span?: Span;
}
/** The string value of a parseman leaf child, or `undefined` for a non-leaf. */
function leafValue(x: unknown): string | undefined {
  const leaf = x as Leaf | undefined;
  return leaf?._tag === 'leaf' && typeof leaf.value === 'string' ? leaf.value : undefined;
}
function leafSpan(x: unknown): Span | undefined {
  return (x as Leaf | undefined)?.span;
}

/**
 * Build an `AtRuleStatement` from the grammar's head children. `name` is the
 * at-keyword leaf verbatim (children[0]). For the generic statement the prelude is
 * the trimmed `atPrelude` leaf between the keyword and the `;` (children[1], absent
 * for a bare `@foo;`). For the `@import` shape — whose prelude is a structured value
 * node, not a leaf — the prelude bytes are recovered from between the keyword and
 * the terminating `;` leaf.
 */
function buildAtRuleStatement(args: BuildArgs): t2.AtRuleStatement | Placeholder {
  const name = leafValue(args.children[0]);
  if (name === undefined || name[0] !== '@') return placeholder(args.type);

  // Generic case: `sequence(atKeyword, atPrelude?, ';')` — always 2 or 3 children,
  // the prelude a single leaf. The `@import` production sharing this type always
  // has a NODE child (its `Quoted`/`Url` path) or MORE children (options paren /
  // media), so it never matches this shape and takes the fallback below.
  const n = args.children.length;
  if (n <= 3) {
    const mid = n === 3 ? leafValue(args.children[1]) : undefined;
    if (n === 2 || mid !== undefined) {
      const prelude = mid !== undefined ? mid.trim() : '';
      return t2.atRuleStatement(name, prelude.length > 0 ? prelude : null);
    }
  }

  // TODO(tier-b): PARSER GAP — the `@import` production shares this type but does
  // not structure its prelude as a single leaf; recover the bytes between the
  // keyword leaf and the terminating `;` leaf until an import family consumes the
  // structured `Url`/`Quoted`/options children.
  const kwEnd = leafSpan(args.children[0])?.end ?? args.span.start;
  const semi = leafSpan(args.children[args.children.length - 1])?.start ?? args.span.end;
  const prelude = args.ctx.src.slice(kwEnd, semi).trim();
  return t2.atRuleStatement(name, prelude.length > 0 ? prelude : null);
}

const atRuleStatement: BuildAction = {
  type: 'AtRuleStatement',
  build: buildAtRuleStatement,
};

export const CHARSET_ACTIONS: readonly BuildAction[] = [atRuleStatement];
