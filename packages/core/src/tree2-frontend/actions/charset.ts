/**
 * [tree2-native] Charset / raw at-STATEMENT family (F16): `@charset "…";` and any
 * statement-form at-rule with no block (`@namespace svg "…";`, `@layer a, b;`, …)
 * → tree2 `AtRuleStatement`.
 *
 * The parseman grammar builds BOTH the generic `AtRuleStatement`
 * (`sequence(atKeyword, atPrelude, ';')`) and the committed import statement under
 * the SAME `node('AtRuleStatement', …)` type — so this action fires for the whole
 * statement-form at-rule surface. It emits the `AtRuleStatement` node DIRECTLY from
 * the source span, mirroring the bridge oracle:
 *   - `toAtRuleStatement` + `atRuleHeaderPrelude` for the generic case, and
 *   - `charsetStatement` for a mid-document `@charset` (parsed as a role-'charset'
 *     `Any` in the legacy tree, but a plain `AtRuleStatement` in the parseman
 *     grammar).
 * Both reduce to the SAME shape: name = the leading `@keyword` token, prelude =
 * the trimmed bytes between the keyword and the terminating `;`. The v5
 * hoist-first / dedupe-rest `@charset` semantics live entirely in the serializer
 * (`emitHoistedCharset`); this family's job is only to BUILD the node.
 *
 * Boundary: touches `../../tree2` only, never the legacy `../tree`. TOTAL — a
 * backtracked branch whose span is not a real `@keyword …` returns an inert
 * placeholder rather than throwing.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, type BuildArgs, type Placeholder, placeholder, sliceSpan } from '../host-context.js';

/** The at-keyword token — same shape as the grammar's `atKeyword` regex, anchored
 *  at the start of the (optionally whitespace-led) statement span. */
const AT_KEYWORD = /^\s*(@-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*)/u;

/**
 * Derive `(name, prelude)` from a statement-form at-rule's source bytes exactly as
 * the bridge does: the leading `@keyword` token names the rule, and the remaining
 * bytes (trailing `;` dropped, then trimmed) are the literal prelude — `null` when
 * empty. Identical to `charsetStatement` for `@charset "…";` and to
 * `atRuleHeaderPrelude(isBlock=false)` for every other statement at-rule.
 */
function buildAtRuleStatement(args: BuildArgs): t2.AtRuleStatement | Placeholder {
  const text = sliceSpan(args.ctx, args.span);
  const m = AT_KEYWORD.exec(text);
  if (m === null) return placeholder(args.type);
  const name = m[1]!;
  const prelude = text.slice(m[0].length).replace(/;\s*$/u, '').trim();
  return t2.atRuleStatement(name, prelude.length > 0 ? prelude : null);
}

const atRuleStatement: BuildAction = {
  type: 'AtRuleStatement',
  build: buildAtRuleStatement,
};

export const CHARSET_ACTIONS: readonly BuildAction[] = [atRuleStatement];
