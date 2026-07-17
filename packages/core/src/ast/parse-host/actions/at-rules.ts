/**
 * At-rule BLOCK family: block at-rules and nested at-rules
 * inside rulesets. (The block-less statement surface — `AtRuleStatement`,
 * `@charset` / `@namespace` / `@layer a, b;` — is owned by the charset/raw-
 * statement family, so it is NOT registered here.)
 *
 * Two grammar types converge on `AtRuleBlock`:
 *   - `AtRuleBlock`       — a generic block at-rule (`@font-face`, `@keyframes`,
 *                           `@page`, `@layer base { … }`, unknown block at-rules).
 *   - `QueryAtRuleBlock`  — a conditional-group block (`@media`/`@supports`/
 *                           `@container`) whose prelude the grammar parses as a
 *                           structured query list; both block shapes reconstruct
 *                           the prelude from SOURCE BYTES (identical to the bridge),
 *                           so one builder serves both.
 *
 * Construction: the at-keyword is the leading `@name` token; the prelude
 * is the bytes between the name and the block `{`, trimmed, and built into a value
 * node (so `@keyframes @name` resolves `@name` through scope) by the bridge's
 * `parseValue` algorithm. Body statements are the real tree2 child nodes (leaf
 * tokens / placeholders filtered out); NESTED at-rules stay nested here — the
 * serializer owns v5 bubbling (projecting a nested conditional-group at-rule to the
 * block level).
 *
 * Actions are TOTAL: a doomed/backtracked branch never throws — the head parse is
 * pure string slicing and the prelude builder always returns a value node.
 *
 * Boundary: emits tree2 directly; no legacy `../tree` import. The prelude value
 * builders replicate the bridge's pure `parseValue` / `interpFromString` helpers
 * (self-contained per family; the bridge is the reference, not an import).
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  isStatement,
  sliceSpan,
} from '../host-context.js';

/** The at-keyword token — same regex the grammar's `atKeyword` consumes, so the
 *  extracted name is byte-identical to what the parser matched (casing + vendor
 *  prefixes preserved: `@MEDIA`, `@-moz-keyframes`). */
const AT_KEYWORD = /^@-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/u;

// TODO(tier-b): at-rule prelude interpolation is a PARSER GAP. The `AtRuleBlock`
// prelude arrives as a SINGLE opaque `scanTo` leaf (not split like an
// `InterpolatedSelector`), and `scanTo` even stops AT `@{`, so `@media @{q}` /
// `@keyframes @{name}` MISPARSE today. This family therefore cannot cleanly consume
// split children — it must slice + tokenize the prelude bytes itself (the helpers
// below). Fix by structuring the prelude in `grammar.ts` (leaf-split like
// `InterpolatedSelector`), then consume the leaves here and drop these regexes.

/**
 * Split a block at-rule's raw source into (name, prelude bytes). Mirrors the
 * bridge's `atRuleHeaderPrelude` (block form): name = the leading at-keyword;
 * prelude = everything between the name and the block `{`, trimmed. An empty
 * prelude is `undefined`.
 */
function atRuleHead(full: string): { name: string; prelude: string | undefined } {
  const m = AT_KEYWORD.exec(full);
  const name = m ? m[0] : '@';
  let rest = full.slice(name.length);
  const brace = rest.indexOf('{');
  if (brace >= 0) rest = rest.slice(0, brace);
  rest = rest.trim();
  return { name, prelude: rest.length > 0 ? rest : undefined };
}

/**
 * `@{name}` interpolation → tree2 `Interp` (value context: refs splice unquoted).
 * Replicates the bridge's `interpFromString`.
 */
function interpFromString(text: string, unquote: boolean): t2.ValueNode {
  const re = /@\{\s*([^}]+?)\s*\}/gu;
  const parts: t2.InterpPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let sawRef = false;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
    parts.push({ ref: t2.varRef(m[1]!), unquote });
    sawRef = true;
    last = m.index + m[0].length;
  }
  if (!sawRef) return t2.word(text);
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/**
 * Tokenize a block at-rule's prelude bytes into a value, turning `@name`
 * references into `VarRef`, `@{name}` into `Interp`, and `@@name` into
 * `VarIndirect`, leaving everything else literal. A static prelude collapses to a
 * single `Word`.
 */
function parsePreludeValue(text: string): t2.ValueNode {
  if (text.indexOf('@') < 0) return t2.word(text);
  const indirect = /^@@([A-Za-z_][\w-]*)$/u.exec(text.trim());
  if (indirect) return t2.varIndirect(t2.varRef(indirect[1]!));
  if (text.includes('@{')) return interpFromString(text, true);
  const re = /@([A-Za-z_][\w-]*)/gu;
  const parts: t2.ValueNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(t2.word(text.slice(last, m.index)));
    parts.push(t2.varRef(m[1]!));
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return t2.word(text);
  if (last < text.length) parts.push(t2.word(text.slice(last)));
  return parts.length === 1 ? parts[0]! : t2.concat(parts);
}

/** Generic + query block at-rule → `AtRuleBlock`. */
function buildBlock(args: BuildArgs): t2.AtRuleBlock {
  const full = sliceSpan(args.ctx, args.span);
  const { name, prelude } = atRuleHead(full);
  const body = args.children.filter(isStatement) as t2.Statement[];
  const preludeNode = prelude === undefined ? null : parsePreludeValue(prelude);
  return t2.atRuleBlock(name, preludeNode, body);
}

const atRuleBlock: BuildAction = { type: 'AtRuleBlock', build: buildBlock };
const queryAtRuleBlock: BuildAction = { type: 'QueryAtRuleBlock', build: buildBlock };

export const AT_RULES_ACTIONS: readonly BuildAction[] = [atRuleBlock, queryAtRuleBlock];
