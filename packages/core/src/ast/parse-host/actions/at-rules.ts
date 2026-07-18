/**
 * At-rule BLOCK family: block at-rules and nested at-rules
 * inside rulesets. (The block-less statement surface — `AtRuleStatement`,
 * `@charset` / `@namespace` / `@layer a, b;` — is owned by the charset/raw-
 * statement family, so it is NOT registered here.)
 *
 * Two grammar types are served here:
 *
 *   - `AtRuleBlock` (generic — `@font-face`, `@keyframes`, `@page`, `@layer base
 *     { … }`, unknown block at-rules). Tier-B: the grammar splits the head into
 *     LEAF children — the at-keyword, then the prelude token run (`@{interp}` /
 *     `@@indirect` / `@var` isolated among literal chunks), then `{`, body, `}`.
 *     `buildGenericBlock` CONSUMES those structured children (P0 — no re-tokenizing
 *     of `ctx.src`): the name is the keyword leaf verbatim, the prelude leaves build
 *     the value via the shared `preludeFromLeaves`. Isolating `@{…}` as a real leaf
 *     also fixes the early-termination bug (`@keyframes @{n} {` used to cut the
 *     prelude at the interpolation's `{`).
 *
 *   - `QueryAtRuleBlock` (`@media`/`@supports`/`@container`). Its prelude is the
 *     grammar's STRUCTURED query list, delivered as ONE opaque `QueryCondition`
 *     child (the tree2 host does not descend into the query grammar), so its Less
 *     value tokens (`@var`/`@{…}` in `(min-width: @bp)`) are not exposed as leaves
 *     here. Structuring the query prelude into consumable leaves is a SEPARATE
 *     Tier-B shape (§3.4 defers it — "query/import families keep their own committed
 *     preludes"); until then `buildQueryBlock` re-derives the prelude from the
 *     source bytes, byte-identically to the pre-Tier-B path.
 *
 * Actions are TOTAL: a doomed/backtracked branch never throws.
 *
 * Boundary: emits tree2 directly; no legacy `../tree` import.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type Span,
  isStatement,
  sliceSpan,
} from '../host-context.js';

/** The string value of a parseman leaf child, or `undefined` for a non-leaf. */
function leafValue(x: unknown): string | undefined {
  const leaf = x as { _tag?: string; value?: unknown } | undefined;
  return leaf?._tag === 'leaf' && typeof leaf.value === 'string' ? leaf.value : undefined;
}
/** The source span of a leaf child, if it carries one. */
function leafSpan(x: unknown): Span | undefined {
  return (x as { span?: Span } | undefined)?.span;
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/** A Less identifier byte (the `lessVar` / `lessInterp` name class: `-_A-Za-z0-9`
 *  plus the non-ASCII `-￿` run). */
function isIdentByte(c: number): boolean {
  return c === 0x2d /* - */ || c === 0x5f /* _ */
    || (c >= 0x30 && c <= 0x39) /* 0-9 */
    || (c >= 0x41 && c <= 0x5a) /* A-Z */
    || (c >= 0x61 && c <= 0x7a) /* a-z */
    || c >= 0x80; /* -￿ */
}

/**
 * True iff `v` is ONE clean Less value token — the grammar's isolated `@name`
 * (`lessVar`), `@@name` (indirect), or `@{name}` (`lessInterp`) leaf — with no
 * interior junk. A grammar-isolated token is always clean; the ONLY unclean
 * `@`-leaf is the opaque `scanTo` region the `AtRuleMalformed` fallback emits for a
 * bare `@var` prelude (v5 hard-rejects it — commit 63663e900), which carries the
 * rest of the prelude (interior spaces / parens / quotes) glued on. Classifying
 * that region as a `@var` synthesized a `VarRef` whose "name" was the whole malformed
 * prelude, which then threw `variable @… is undefined` at eval. Emitting it verbatim
 * instead recovers gracefully (parse error already recorded; render diverges from the
 * 4.x-style golden — the intended v5 divergence), never throwing.
 */
function isCleanRefToken(v: string): boolean {
  const n = v.length;
  if (n < 2 || v.charCodeAt(0) !== 0x40 /* @ */) return false;
  const c1 = v.charCodeAt(1);
  if (c1 === 0x7b /* { */) {
    // `@{name}`: closes with `}`, interior is an identifier run (a leading `-` ok).
    if (n < 3 || v.charCodeAt(n - 1) !== 0x7d /* } */) return false;
    for (let i = 2; i < n - 1; i++) if (!isIdentByte(v.charCodeAt(i))) return false;
    return n > 3;
  }
  // `@name` / `@@name`: every byte after the sigil(s) is an identifier byte.
  const start = c1 === 0x40 /* @ */ ? 2 : 1;
  if (start >= n) return false;
  for (let i = start; i < n; i++) if (!isIdentByte(v.charCodeAt(i))) return false;
  return true;
}

/** A Less value token the grammar isolated in the prelude, keyed by its span. */
interface PreludeTok {
  readonly kind: 'var' | 'interp' | 'indirect';
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Generic block at-rule → `AtRuleBlock`. The grammar splits the head into leaf
 * children (`@keyword`, the prelude token run, `{`, body, `}`); this CONSUMES the
 * Less value tokens the grammar isolated in the prelude — `@{interp}` / `@@indirect`
 * / `@var` leaves — and fills the gaps between them with the VERBATIM prelude source
 * (P0: the token boundaries come from the parser's leaf spans, never a re-scan; the
 * gaps carry comments and exact spacing unchanged). Mirrors the classification the
 * old prelude regexes produced:
 *   • no `@` token          → a single literal `Any` (comments preserved)
 *   • exactly `@@name`      → `VarIndirect`
 *   • any top-level `@{…}`  → `Interp` (bare `@var` stays literal, as the old
 *                             `@{`-only split left it; `@{…}` inside a string/paren-
 *                             string is not a top-level leaf, so it stays literal —
 *                             string interpolation is a separate Tier-B shape)
 *   • otherwise `@var` runs → `VarRef`s interleaved with literal `Any` gaps
 */
function buildGenericBlock(args: BuildArgs): t2.AtRuleBlock {
  const { children } = args;
  const name = leafValue(children[0]) ?? '@';
  const body = children.filter(isStatement) as t2.Statement[];

  // Prelude region: from the keyword leaf end to the first block `{` leaf start.
  const src = args.ctx.src;
  let ps = leafSpan(children[0])?.end ?? args.span.start;
  let braceStart = args.span.end;
  const toks: PreludeTok[] = [];
  for (let i = 1; i < children.length; i++) {
    const v = leafValue(children[i]);
    if (v === '{') {
      braceStart = leafSpan(children[i])?.start ?? braceStart;
      break;
    }
    const span = leafSpan(children[i]);
    if (v === undefined || span === undefined) continue;
    const c0 = v.charCodeAt(0);
    if (c0 !== 0x40 /* @ */) continue;
    // A malformed bare-`@var` prelude arrives as one opaque `scanTo` leaf (interior
    // spaces/parens); it is NOT a clean ref token, so leave it in the literal gap
    // (rendered verbatim) rather than synthesizing a throwing `VarRef` from it.
    if (!isCleanRefToken(v)) continue;
    const c1 = v.charCodeAt(1);
    if (c1 === 0x7b /* { */) toks.push({ kind: 'interp', name: v.slice(2, -1).trim(), start: span.start, end: span.end });
    else if (c1 === 0x40 /* @ */) toks.push({ kind: 'indirect', name: v.slice(2), start: span.start, end: span.end });
    else toks.push({ kind: 'var', name: v.slice(1), start: span.start, end: span.end });
  }
  let pe = braceStart;
  // Trim the region's outer WHITESPACE (the old prelude slice was `.trim()`ed);
  // interior comments / spacing survive verbatim in the gaps below.
  while (ps < pe && isWs(src[ps]!)) ps++;
  while (pe > ps && isWs(src[pe - 1]!)) pe--;
  if (ps >= pe) return t2.atRuleBlock(name, null, body);

  // No Less value token → the region is a single verbatim literal.
  if (toks.length === 0) return t2.atRuleBlock(name, t2.any(src.slice(ps, pe)), body);

  // Exactly `@@name` spanning the whole (trimmed) region → indirect reference.
  if (toks.length === 1 && toks[0]!.kind === 'indirect' && toks[0]!.start === ps && toks[0]!.end === pe) {
    return t2.atRuleBlock(name, t2.varIndirect(t2.varRef(toks[0]!.name)), body);
  }

  // Any top-level `@{…}` → an `Interp`; interp tokens become refs, every other byte
  // (literal gaps AND bare `@var` bytes) is a verbatim literal part.
  const hasInterp = toks.some((t) => t.kind === 'interp');
  if (hasInterp) {
    const parts: t2.InterpPart[] = [];
    let cursor = ps;
    for (const t of toks) {
      if (t.kind !== 'interp') continue;
      if (t.start > cursor) parts.push({ lit: src.slice(cursor, t.start) });
      parts.push({ ref: t2.varRef(t.name), unquote: true });
      cursor = t.end;
    }
    if (cursor < pe) parts.push({ lit: src.slice(cursor, pe) });
    return t2.atRuleBlock(name, t2.interp(parts), body);
  }

  // `@var` (and lone `@@name`) split: each token → a reference, gaps → verbatim `Any`.
  const parts: t2.ValueNode[] = [];
  let cursor = ps;
  for (const t of toks) {
    if (t.start > cursor) parts.push(t2.any(src.slice(cursor, t.start)));
    parts.push(t.kind === 'indirect' ? t2.varIndirect(t2.varRef(t.name)) : t2.varRef(t.name));
    cursor = t.end;
  }
  if (cursor < pe) parts.push(t2.any(src.slice(cursor, pe)));
  const prelude = parts.length === 1 ? parts[0]! : t2.concat(parts);
  return t2.atRuleBlock(name, prelude, body);
}

// TODO(tier-b/query-prelude): WHAT — the `AT_KEYWORD` / `parsePreludeValue` /
// `interpFromString` byte re-tokenizers below (this file's only remaining regexes)
// serve the QUERY at-rule prelude. WHY — `@media`/`@supports`/`@container` deliver
// their prelude as one opaque `QueryCondition` node, so the Less value tokens inside
// a query (`@media (min-width: @bp)`, `@media all and (…: ~'@{r}')`) are NOT
// consumable as leaves here (unlike the generic block path above, which is
// regex-free). RETIREMENT TRIGGER — remove when the QUERY grammar splits its prelude
// into `@var`/`@{…}` leaves (a separate Tier-B shape; §3.4 keeps the query prelude
// committed for now). This is NOT legacy-builder-coupled — it is a grammar-coverage
// gap, safe to structure whenever the query grammar is reworked.

/** The at-keyword token — same shape the grammar's `atKeyword` consumes. */
const AT_KEYWORD = /^@-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/u;

/**
 * `@{name}` interpolation → tree2 `Interp` (value context: refs splice unquoted).
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
  if (!sawRef) return t2.any(text);
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/**
 * Tokenize a query at-rule's prelude bytes into a value, turning `@name` into
 * `VarRef`, `@{name}` into `Interp`, and `@@name` into `VarIndirect`, leaving
 * everything else literal. A static prelude collapses to a single `Any`.
 */
function parsePreludeValue(text: string): t2.ValueNode {
  if (text.indexOf('@') < 0) return t2.any(text);
  const indirect = /^@@([A-Za-z_][\w-]*)$/u.exec(text.trim());
  if (indirect) return t2.varIndirect(t2.varRef(indirect[1]!));
  if (text.includes('@{')) return interpFromString(text, true);
  const re = /@([A-Za-z_][\w-]*)/gu;
  const parts: t2.ValueNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(t2.any(text.slice(last, m.index)));
    parts.push(t2.varRef(m[1]!));
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return t2.any(text);
  if (last < text.length) parts.push(t2.any(text.slice(last)));
  return parts.length === 1 ? parts[0]! : t2.concat(parts);
}

/** Conditional-group (query) block at-rule → `AtRuleBlock` (query-prelude path). */
function buildQueryBlock(args: BuildArgs): t2.AtRuleBlock {
  const full = sliceSpan(args.ctx, args.span);
  const m = AT_KEYWORD.exec(full);
  const name = m ? m[0] : '@';
  let rest = full.slice(name.length);
  const brace = rest.indexOf('{');
  if (brace >= 0) rest = rest.slice(0, brace);
  rest = rest.trim();
  const body = args.children.filter(isStatement) as t2.Statement[];
  return t2.atRuleBlock(name, rest.length > 0 ? parsePreludeValue(rest) : null, body);
}

const atRuleBlock: BuildAction = { type: 'AtRuleBlock', build: buildGenericBlock };
const queryAtRuleBlock: BuildAction = { type: 'QueryAtRuleBlock', build: buildQueryBlock };

export const AT_RULES_ACTIONS: readonly BuildAction[] = [atRuleBlock, queryAtRuleBlock];
