/**
 * parser -> tree2 BRIDGE (front end).
 *
 * This file lives OUTSIDE `tree2/` on purpose. The hard module boundary forbids
 * any file under `tree2/` from importing the legacy `../tree`; the BRIDGE is
 * explicitly allowed to touch the parser + `../tree` types, because parsing is a
 * shared front end (~17%), not the eval/render machinery tree2 replaces. The
 * bridge's OUTPUT is pure tree2 nodes; tree2 itself never sees `../tree`.
 *
 * Source of truth: the Less functional parser's structural `tree` AST
 * (`parseLessFn(...).tree`, a `Rules` root), NOT the raw CST. Rationale: the
 * tree AST is exactly the structure the oracle renders, and the parser's
 * builders have already resolved selectors/compounds/combinators/mixins into
 * clean structural nodes. Re-deriving that from CST leaves/tokens would
 * duplicate the builder's work with no benefit for the shapes tree2 supports.
 * The tree AST carries source spans (`sourceSpanOf`), which the bridge uses to
 * capture STATIC value bytes verbatim — tree2 does no value eval by design, so a
 * static value is an opaque token, faithful to tree2's model.
 *
 * Supported shapes: rules, selector lists / compound / combinators,
 * nesting + `&`, static/spaced declarations (incl. `!important`), mixin
 * definition (`.m() {}`) with positional params, mixin call (`.m()`). Anything
 * else raises `UnsupportedShape`, which the census collects and ranks.
 */

import { parseLessFn } from '@jesscss/less-parser';
import * as t2 from '../../index.js';
import { type Combinator } from '../../index.js';
import { sourceSpanOf } from '../../../tree/util/provenance.js';
// [import] resolution/inlining lives in a sibling front-end file (kept out of
// this shared dispatch file to minimize churn); wired in via `toStatement`.
import {
  createImportState,
  resolveImportStatements,
  isNode,
  nodeType as typeOf,
  type AnyNode,
  type ImportState,
} from '../import.js';

export class UnsupportedShape extends Error {
  constructor(
    readonly feature: string,
    readonly detail: string,
  ) {
    super(`${feature}: ${detail}`);
    this.name = 'UnsupportedShape';
  }
}

interface BridgeCtx {
  source: string;
  // [import] absolute path of the file being bridged (import paths resolve
  // relative to it) + the shared once-dedup/cycle state for the whole run.
  filePath?: string;
  importState: ImportState;
}

function slice(ctx: BridgeCtx, node: object): string | undefined {
  const span = sourceSpanOf(node);
  return span ? ctx.source.slice(span.start, span.end) : undefined;
}

/* ------------------------------------------------------------- selectors */

const COMBINATORS = new Set([' ', '>', '+', '~']);

/** Text of one simple-selector element (string or node). */
function simpleText(ctx: BridgeCtx, el: unknown): string {
  if (typeof el === 'string') return el;
  if (isNode(el)) {
    const t = typeOf(el);
    if (t === 'Ampersand') {
      // A bare `&`, or `&`-with-append (`&-foo` → the fused token `&-foo`).
      const appendValue = (el as AnyNode).appendValue;
      if (appendValue !== undefined && appendValue !== null && appendValue !== '') {
        if (typeof appendValue === 'string') return '&' + appendValue;
        // An interpolated append (`&@{x}`) is deferred.
        throw new UnsupportedShape('selector:ampersand-append', typeOf(appendValue));
      }
      return '&';
    }
    const raw = slice(ctx, el);
    if (raw !== undefined) return raw;
    // Fallbacks for pseudo/attribute-ish nodes that expose a name.
    const name = (el as AnyNode).name;
    if (typeof name === 'string') return name;
  }
  throw new UnsupportedShape('selector:simple', typeOf(el));
}

/** Build a tree2 Simple from a string token, interpolating `@{…}`. */
function toSimpleFromString(s: string): t2.Simple {
  if (s.includes('@{')) {
    const interp = interpFromString(s, false); // selector context: refs as-is
    if (interp.type === 'Interp') return t2.simpleInterp(interp);
  }
  return t2.simple(s);
}

/** Build a tree2 Simple from a selector element (string / node), detecting
 * `InterpolatedSelector` and inline `@{…}` interpolation. */
function toSimple(ctx: BridgeCtx, el: unknown): t2.Simple {
  if (isNode(el) && typeOf(el) === 'InterpolatedSelector') {
    return t2.simpleInterp(interpFromInterpolated(ctx, (el as AnyNode).value as AnyNode, false));
  }
  return toSimpleFromString(simpleText(ctx, el));
}

/** Build a tree2 Compound from a CompoundSelector node or a bare string. */
function toCompound(ctx: BridgeCtx, sel: unknown): t2.Compound {
  if (typeof sel === 'string') return t2.compoundOf([toSimpleFromString(sel)]);
  if (isNode(sel) && typeOf(sel) === 'InterpolatedSelector') {
    return t2.compoundOf([toSimple(ctx, sel)]);
  }
  if (isNode(sel) && typeOf(sel) === 'CompoundSelector') {
    const parts = (sel as AnyNode).value;
    if (!Array.isArray(parts)) throw new UnsupportedShape('selector:compound-shape', typeOf(sel));
    return t2.compoundOf(parts.map((p) => toSimple(ctx, p)));
  }
  // A single simple node (e.g. Ampersand alone, PseudoSelector alone).
  return t2.compoundOf([toSimple(ctx, sel)]);
}

/** Build a tree2 Complex from a string / CompoundSelector / ComplexSelector. */
function toComplex(ctx: BridgeCtx, sel: unknown): t2.Complex {
  if (typeof sel === 'string') {
    // A raw selector string may itself contain combinators (rare in tree AST,
    // but keep it robust): only accept a single compound token here.
    if (/[>+~]|\s/.test(sel.trim()) && sel.trim().length > 1) {
      // contains a combinator: parse into segments below via string path
      return complexFromString(sel);
    }
    return t2.complex([{ compound: t2.compound(sel) }]);
  }
  if (isNode(sel)) {
    const t = typeOf(sel);
    if (t === 'ComplexSelector') {
      const items = (sel as AnyNode).value;
      if (!Array.isArray(items)) throw new UnsupportedShape('selector:complex-shape', t);
      const segments: Array<{ comb?: Combinator; compound: t2.Compound }> = [];
      let pendingComb: Combinator = ' ';
      let leadingComb: Combinator | undefined;
      let first = true;
      let sawItem = false;
      for (const item of items) {
        if (typeof item === 'string' && COMBINATORS.has(item)) {
          pendingComb = item as Combinator;
          // A combinator BEFORE any compound is a leading combinator (e.g.
          // `.a { > .b {} }` → child selector `> .b`), preserved verbatim.
          if (!sawItem && item !== ' ') leadingComb = item as Combinator;
          continue;
        }
        sawItem = true;
        if (first) {
          segments.push({ compound: toCompound(ctx, item) });
          first = false;
        } else {
          segments.push({ comb: pendingComb, compound: toCompound(ctx, item) });
          pendingComb = ' ';
        }
      }
      if (segments.length === 0) throw new UnsupportedShape('selector:complex-empty', t);
      return t2.complex(segments, leadingComb);
    }
    if (t === 'CompoundSelector') {
      return t2.complex([{ compound: toCompound(ctx, sel) }]);
    }
    // single simple node
    return t2.complex([{ compound: toCompound(ctx, sel) }]);
  }
  throw new UnsupportedShape('selector:complex', typeOf(sel));
}

/** Minimal string->complex splitter for the rare all-string combinator case. */
function complexFromString(s: string): t2.Complex {
  const toks = s.trim().split(/\s+/);
  const segments: Array<{ comb?: Combinator; compound: t2.Compound }> = [];
  let pendingComb: Combinator = ' ';
  let first = true;
  for (const tok of toks) {
    if (COMBINATORS.has(tok)) {
      pendingComb = tok as Combinator;
      continue;
    }
    if (first) {
      segments.push({ compound: t2.compound(tok) });
      first = false;
    } else {
      segments.push({ comb: pendingComb, compound: t2.compound(tok) });
      pendingComb = ' ';
    }
  }
  return t2.complex(segments);
}

/** Build a tree2 SelectorList from a Ruleset's `.selector` (string/node/array). */
function toSelectorList(ctx: BridgeCtx, sel: unknown): t2.SelectorList {
  if (Array.isArray(sel)) {
    return t2.selist(...sel.map((s) => toComplex(ctx, s)));
  }
  // A SelectorList-like node with `.value`?
  if (isNode(sel) && Array.isArray((sel as AnyNode).value) && isSelectorListNode(sel)) {
    const items = (sel as AnyNode).value as unknown[];
    return t2.selist(...items.map((s) => toComplex(ctx, s)));
  }
  return t2.selist(toComplex(ctx, sel));
}

function isSelectorListNode(sel: AnyNode): boolean {
  const t = typeOf(sel);
  return t === 'SelectorList' || t === 'List';
}

/* ------------------------------------------------------------ declarations */

/**
 * Raw value bytes of a `name: value;` / `@name: value;` node from its source
 * span (works for both Declaration and VarDeclaration — same source shape).
 * `!important`, when present, is included (tree2 has no important field).
 */
function rawDeclValue(ctx: BridgeCtx, node: AnyNode): string {
  const declText = slice(ctx, node);
  if (declText === undefined) throw new UnsupportedShape('decl:no-span', String(node.name));
  const body = declText.replace(/;\s*$/, '');
  const colon = body.indexOf(':');
  if (colon < 0) throw new UnsupportedShape('decl:no-colon', String(node.name));
  return body.slice(colon + 1).trim();
}

/**
 * [WS2] Raw value bytes of a `--custom: …;` CUSTOM-PROPERTY declaration, kept
 * VERBATIM (Less v5 does NOT alter custom properties — they can carry any
 * unknown token stream, functions/bare `@var` stay literal), with ONLY `@{…}`
 * interpolation resolved. The serializer emits `name` + `: ` (colon + one
 * space) + value, so one leading whitespace char is dropped from the captured
 * bytes to keep the authored inner spacing byte-faithful; a whitespace-only
 * value collapses to empty (`--x: ;`). Any inline `!important` stays in the
 * bytes (verbatim), so no structured important flag is set.
 */
function customDeclValue(ctx: BridgeCtx, node: AnyNode): t2.ValueNode {
  const declText = slice(ctx, node);
  if (declText === undefined) throw new UnsupportedShape('custom-decl:no-span', String(node.name));
  const body = declText.replace(/;\s*$/u, '');
  const colon = body.indexOf(':');
  if (colon < 0) throw new UnsupportedShape('custom-decl:no-colon', String(node.name));
  let raw = body.slice(colon + 1);
  if (raw.trim() === '') return t2.any('');
  if (raw[0] === ' ' || raw[0] === '\t') raw = raw.slice(1);
  // interpFromString resolves `@{…}` (value context, unquote) and returns a
  // verbatim `Any` when no interpolation is present (bare `@var`/fns literal).
  return interpFromString(raw, true);
}

/**
 * Tokenize static value bytes into a tree2 value, turning `@name` references
 * into `VarRef` nodes and leaving everything else literal. `@{name}`
 * interpolation tokens (before the bare-`@name` pass) yield an `Interp`; a bare
 * `@@name` indirect variable yields a `VarIndirect`; a value with only bare
 * `@name` still yields `Concat`/`VarRef` (byte-unchanged).
 */
function parseValue(text: string): t2.ValueNode {
  if (text.indexOf('@') < 0) return t2.any(text);
  // `@@name` indirect variable (standalone).
  const indirect = /^@@([A-Za-z_][\w-]*)$/.exec(text.trim());
  if (indirect) return t2.varIndirect(t2.varRef(indirect[1]!));
  // `@{name}` interpolation present → build an Interp (value context: refs
  // splice unquoted).
  if (text.includes('@{')) return interpFromString(text, true);
  const re = /@([A-Za-z_][\w-]*)/g;
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

/* --------------------------------------------------------- interpolation */

/**
 * Build an `Interp` from a raw string containing `@{name}` tokens. `unquote`
 * controls whether spliced refs strip one surrounding quote layer (true in
 * value/string context; false in selector / property-name context). Bare `@name`
 * inside the literal chunks is left literal (matches Less: only `@{…}` interps).
 */
function interpFromString(text: string, unquote: boolean): t2.ValueNode {
  const re = /@\{\s*([^}]+?)\s*\}/g;
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

/** The variable NAME of a parser `Reference.key` (string / Keyword / raw). */
function referenceKeyName(ctx: BridgeCtx, key: unknown): string {
  if (typeof key === 'string') return key;
  if (isNode(key)) {
    const t = typeOf(key);
    if (t === 'Keyword' && typeof (key as AnyNode).value === 'string') return (key as AnyNode).value as string;
    const raw = slice(ctx, key);
    if (raw !== undefined) return raw;
  }
  throw new UnsupportedShape('reference:key', typeOf(key));
}

/** Convert one interpolation replacement (a parser `Reference`) to a ref. */
function replacementToValue(ctx: BridgeCtx, repl: unknown): t2.ValueNode {
  if (isNode(repl) && typeOf(repl) === 'Reference') {
    const key = (repl as AnyNode).key;
    // A nested-interpolated name (`@{box-@{suffix}}`) resolves to a NAME, then
    // that variable is looked up → an indirect variable over the inner interp.
    if (isNode(key) && typeOf(key) === 'Interpolated') {
      return t2.varIndirect(interpFromInterpolated(ctx, key as AnyNode, true));
    }
    return t2.varRef(referenceKeyName(ctx, key));
  }
  // Fallback: a literal replacement.
  if (typeof repl === 'string') return t2.any(repl);
  const raw = isNode(repl) ? slice(ctx, repl) : undefined;
  return t2.any(raw ?? '');
}

/**
 * Build an `Interp` from a parser `Interpolated` node (`source` with `%%`
 * placeholders + `replacements`). `unquote` controls ref quote-stripping.
 */
function interpFromInterpolated(ctx: BridgeCtx, node: AnyNode, unquote: boolean): t2.Interp {
  const source = typeof node.source === 'string' ? node.source : '';
  const replacements = Array.isArray(node.replacements) ? node.replacements : [];
  const segs = source.split('%%');
  const parts: t2.InterpPart[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (segs[i]!.length > 0) parts.push({ lit: segs[i]! });
    if (i < replacements.length) parts.push({ ref: replacementToValue(ctx, replacements[i]), unquote });
  }
  return t2.interp(parts);
}

/** Build an interpolation value from a parser `Quoted` wrapping an
 * `Interpolated`. Non-escaped keeps the surrounding quote bytes; escaped
 * (`~"…"`) drops them. Refs splice unquoted (value/string context). */
function interpFromQuoted(ctx: BridgeCtx, node: AnyNode): t2.ValueNode {
  const inner = node.value;
  if (!isNode(inner) || typeOf(inner) !== 'Interpolated') return t2.any(slice(ctx, node) ?? '');
  const escaped = node.escaped === true;
  const quote = escaped ? '' : typeof node.quote === 'string' ? node.quote : '"';
  const interp = interpFromInterpolated(ctx, inner as AnyNode, true);
  if (!quote) return interp;
  return t2.interp([{ lit: quote }, ...interp.parts, { lit: quote }]);
}

/* ------------------------------------------------------ value expressions */

/** Inner argument source of a call: text between the first `(` and last `)`. */
function innerArgsSource(callSource: string): string {
  const open = callSource.indexOf('(');
  const close = callSource.lastIndexOf(')');
  if (open < 0 || close <= open) return '';
  return callSource.slice(open + 1, close);
}

/**
 * Model a function call's arguments as a typed tree2 value list. The parsed
 * Less `Call.args` is a `List` whose `.value` is either a flat array of comma
 * args, or (for CSS Color-4 modern syntax) a single space-separated group whose
 * `/`-separated sub-lists flatten to scalar leaves. Returns the flat arg nodes
 * plus a `modern` flag so the evaluator preserves the `rgb(a b c / d)` spelling.
 */
function bridgeFnArgs(ctx: BridgeCtx, argsNode: unknown): { args: t2.ValueNode[]; modern: boolean } {
  const arr = isNode(argsNode) ? (argsNode as AnyNode).value : argsNode;
  if (!Array.isArray(arr)) return { args: [], modern: false };
  let modern = false;
  let flat: unknown[];
  if (arr.length === 1 && (Array.isArray(arr[0]) || isSpaceGroup(arr[0]))) {
    modern = true;
    flat = [];
    flattenSpaceGroup(arr[0], flat);
  } else {
    flat = arr;
  }
  const args: t2.ValueNode[] = [];
  for (const a of flat) {
    const v = toOperand(ctx, a);
    if (v === null) throw new UnsupportedShape('call:arg', typeOf(a));
    args.push(v);
  }
  return { args, modern };
}

/** A space/slash-separated arg group (a `List` node used inside modern syntax). */
function isSpaceGroup(x: unknown): boolean {
  return isNode(x) && typeOf(x) === 'List' && Array.isArray((x as AnyNode).value);
}

/** Flatten a modern-syntax arg group (nested arrays / slash-lists) to scalar leaves. */
function flattenSpaceGroup(group: unknown, out: unknown[]): void {
  const items = Array.isArray(group) ? group : isNode(group) ? (group as AnyNode).value : undefined;
  if (!Array.isArray(items)) {
    out.push(group);
    return;
  }
  for (const it of items) {
    if (Array.isArray(it) || isSpaceGroup(it)) flattenSpaceGroup(it, out);
    else out.push(it);
  }
}

/**
 * Build a tree2 value node from a parsed Less value node, producing STRUCTURED
 * tree2 `FunctionCall` / `Operation` / `Paren` nodes for computed expressions.
 * Returns `null` for anything that is not (and does not contain at this level) a
 * computed expression, so the caller falls back to raw-bytes capture — keeping
 * every existing static/variable pass byte-identical.
 *
 * Value MATH is not performed here: the nodes carry structure only, and the
 * injected value service computes them at serialize time.
 */
function toComputedValue(ctx: BridgeCtx, node: unknown): t2.ValueNode | null {
  if (!isNode(node)) return null;
  const t = typeOf(node);
  switch (t) {
    case 'Call': {
      const name = mixinName(node as AnyNode);
      // Model the arg LIST (typed params bind at eval): comma args are a flat
      // array; CSS Color-4 modern syntax (`rgb(0 128 255 / 50%)`) is a single
      // space-separated group (possibly nested slash-lists) — flatten to leaves and
      // flag `modern` so the evaluator preserves the output spelling.
      const { args, modern } = bridgeFnArgs(ctx, (node as AnyNode).args);
      return t2.funcCall(name, args, modern);
    }
    case 'Paren': {
      const inner = toComputedValue(ctx, (node as AnyNode).value);
      if (inner === null) {
        const raw = slice(ctx, (node as AnyNode).value as object);
        return raw === undefined ? null : t2.paren(parseValue(raw));
      }
      return t2.paren(inner);
    }
    case 'Operation': {
      const operator = (node as AnyNode).operator;
      if (typeof operator !== 'string') return null;
      const left = toOperand(ctx, (node as AnyNode).left);
      const right = toOperand(ctx, (node as AnyNode).right);
      if (left === null || right === null) return null;
      return t2.operation(operator, left, right);
    }
    // a quoted string that embeds interpolation (`"…@{x}…"` / `~"…@{x}…"`),
    // or an escaped literal (`~'x'` → `x`, unquoted).
    case 'Quoted': {
      const q = node as AnyNode;
      const inner = q.value;
      if (isNode(inner) && typeOf(inner) === 'Interpolated') return interpFromQuoted(ctx, q);
      if (q.escaped === true && typeof inner === 'string') return t2.any(inner); // `~'x'` → x
      return null; // plain quoted string → byte-identical raw-bytes fallback
    }
    // a bare interpolation value (unquoted context).
    case 'Interpolated':
      return interpFromInterpolated(ctx, node as AnyNode, true);
    // a map / namespace accessor `@p[text]` / `#ns[$@prop]` (Reference with a
    // `target`), OR an `@@name` indirect variable.
    case 'Reference': {
      const ref = node as AnyNode;
      if (ref.target !== undefined && ref.target !== null) return buildMapAccessor(ctx, ref);
      return null; // plain `@name` → raw-bytes VarRef fallback (byte-unchanged)
    }
    // a detached ruleset value `{ … }` (parser: a Mixin with no name/params).
    case 'Mixin': {
      const m = node as AnyNode;
      if (m.name === undefined && m.params === undefined) {
        return t2.detachedRuleset(toBody(ctx, m.rules, true));
      }
      return null;
    }
    default:
      return null;
  }
}

/** Build a `MapAccessor` from a parser `Reference` with a `target`. */
function buildMapAccessor(ctx: BridgeCtx, ref: AnyNode): t2.ValueNode {
  const target = ref.target;
  if (!isNode(target)) throw new UnsupportedShape('map:target', typeOf(target));
  const baseName = referenceKeyName(ctx, (target as AnyNode).key);
  const base: t2.ValueNode =
    baseName.startsWith('#') || baseName.startsWith('.') ? t2.any(baseName) : t2.varRef(baseName);
  const key = ref.key;
  const bytes = slice(ctx, ref) ?? '';
  // Numeric index (`[1]` / `[-1]`).
  if (typeof key === 'number') return t2.mapAccessor(base, key, false, bytes);
  if (isNode(key)) {
    const t = typeOf(key);
    if (t === 'Quoted') {
      const v = (key as AnyNode).value;
      if (isNode(v) && typeOf(v) === 'Interpolated') {
        return t2.mapAccessor(base, interpFromInterpolated(ctx, v as AnyNode, false), true, bytes);
      }
      if (typeof v === 'string') return t2.mapAccessor(base, t2.any(v), true, bytes);
    }
    if (t === 'Interpolated') {
      return t2.mapAccessor(base, interpFromInterpolated(ctx, key as AnyNode, false), true, bytes);
    }
    // A dimension / number key node → numeric index.
    if (t === 'Dimension' || t === 'Num') {
      const n = Number((key as AnyNode).value ?? (key as AnyNode).number);
      if (Number.isFinite(n)) return t2.mapAccessor(base, n, false, bytes);
    }
    const raw = slice(ctx, key);
    if (raw !== undefined) return t2.mapAccessor(base, t2.any(raw), true, bytes);
  }
  if (typeof key === 'string') return t2.mapAccessor(base, t2.any(key), true, bytes);
  throw new UnsupportedShape('map:key', typeOf(key));
}

/**
 * [E3] The source span of a parser Array (a space-separated arg group), spanning
 * its first through last leaf. A nested `/`-separated `List` wrapper carries no
 * own span, so descend its `.value` for the bounding offsets.
 */
function arraySpan(arr: readonly unknown[]): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) {
      x.forEach(visit);
      return;
    }
    if (!isNode(x)) return;
    const sp = sourceSpanOf(x);
    if (sp) {
      if (sp.start < start) start = sp.start;
      if (sp.end > end) end = sp.end;
      return;
    }
    const v = (x as AnyNode).value;
    if (Array.isArray(v)) v.forEach(visit);
  };
  arr.forEach(visit);
  return end >= start ? { start, end } : null;
}

/** [E3] `s` begins with `(` and ends with `)` AND that opening paren matches the
 *  closing one (depth returns to 0 only at the final char) — a single wrap. */
function isBalancedWrap(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0 && i !== s.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * [E3] A space-separated arg group (parser Array — a list / grid-track arg, e.g.
 * `.m(a b c)` or `.grid(1fr 1fr / auto)`). Capture its source bytes verbatim so
 * the bound param re-emits them faithfully — consistent with the raw-bytes
 * fallback used for a single static/variable value.
 *
 * A `Keyword` element's source span carries the parser's parenthesis quirk (its
 * span includes the call's own wrapping `(...)`); when such a keyword sits at the
 * group's boundary the raw slice picks up those parens, so strip a single
 * balanced outer pair. A space list itself never carries meaningful outer parens
 * — a genuinely parenthesized value parses to a `Paren`/`Operation`, not an Array.
 */
function arrayValue(ctx: BridgeCtx, arr: readonly unknown[]): t2.ValueNode | null {
  const span = arraySpan(arr);
  if (span === null) return null;
  let text = ctx.source.slice(span.start, span.end);
  if (text.length >= 2 && text[0] === '(' && text[text.length - 1] === ')' && isBalancedWrap(text)) {
    text = text.slice(1, -1);
  }
  return parseValue(text.trim());
}

/**
 * [value node model] The value CLASS of a typed legacy value LEAF, so the bridge
 * builds the honest tree2 leaf node (`Dimension`/`Color`/`Quoted`/`Keyword`/`Any`)
 * whose `type` carries that class (task #44 — no side-car tag). Returns `undefined`
 * for a non-leaf / unclassified node, where the produced `Any` leaf's byte sniff
 * fallback still holds.
 */
type LeafKind = 'dim' | 'color' | 'bool' | 'keyword' | 'quoted' | 'any';
type NumFields = { number: number; unit: string };
type QuotedFields = { value: string; quote: string; escaped: boolean };
type LeafFields = NumFields | QuotedFields;

function leafKindOf(node: AnyNode): LeafKind | undefined {
  switch (typeOf(node)) {
    case 'Dimension':
    case 'Num':
      return 'dim';
    case 'Color':
      // Hex vs named is recovered at materialize from `src[0] === '#'`, so one kind.
      return 'color';
    // [§CORR-4] `true`/`false` build a `Keyword` leaf (no AST `Bool` node); guard
    // booleanness is recovered downstream via the value-domain `Bool` sniff.
    case 'Bool':
      return 'bool';
    case 'Keyword':
      return 'keyword';
    case 'Quoted':
      return 'quoted';
    case 'Anonymous':
      return 'any';
    default:
      return undefined;
  }
}

/**
 * [value node model] The parser's pre-split fields for a numeric / quoted leaf, so
 * the built node carries them (no byte re-split at materialize). The legacy node
 * carries `number`/`unit` (Dimension / Num) or the inner `value` + `quote` +
 * `escaped` (a plain, non-escaped Quoted — escaped `~"…"` is lowered upstream to a
 * bare word before reaching here). Any other leaf carries no fields.
 */
function fieldsOf(node: AnyNode, kind: LeafKind | undefined): LeafFields | undefined {
  if (kind === 'dim') {
    return { number: node.number as number, unit: (node.unit as string | undefined) ?? '' };
  }
  if (kind === 'quoted' && typeof node.value === 'string') {
    return { value: node.value, quote: typeof node.quote === 'string' ? node.quote : '"', escaped: node.escaped === true };
  }
  return undefined;
}

/**
 * [value node model] Build the honest typed leaf node from a freshly-parsed opaque
 * leaf. A typed legacy leaf's bytes carry no `@`, so `parseValue` returns a bare
 * `Any` — its verbatim `src` + the leaf's class build the typed node. A multi-part
 * value (`Concat`/`VarRef`/…) is not a single literal and is returned unchanged.
 */
function stampLeaf(v: t2.ValueNode, kind: LeafKind | undefined, fields?: LeafFields): t2.ValueNode {
  if (kind === undefined || v.type !== 'Any') return v;
  const src = v.src;
  switch (kind) {
    case 'dim':
      return fields && 'number' in fields ? t2.dimension(fields.number, fields.unit, src) : t2.any(src);
    case 'color':
      return t2.color(src);
    case 'bool':
    case 'keyword':
      return t2.keyword(src);
    case 'quoted':
      return fields && 'value' in fields ? t2.quoted(src, fields.value, fields.quote, fields.escaped) : t2.any(src);
    default:
      return t2.any(src);
  }
}

/** An operand of an operation / guard / mixin arg: computed expr or raw leaf. */
function toOperand(ctx: BridgeCtx, node: unknown): t2.ValueNode | null {
  const computed = toComputedValue(ctx, node);
  if (computed !== null) return computed;
  if (typeof node === 'string') return parseValue(node);
  // [E3] a space-separated list arg (`.m(a b c)`) arrives as a bare Array.
  if (Array.isArray(node)) return arrayValue(ctx, node);
  if (isNode(node)) {
    const kind = leafKindOf(node); // [value node model] classify at production
    const fields = fieldsOf(node, kind); // pre-split number/unit or quote/value/escaped
    // [guards] A `Keyword` node's source span can include a wrapping `(...)`
    // (parser quirk for single mixin args); its `.value` is the clean text.
    if (typeOf(node) === 'Keyword' && typeof (node as AnyNode).value === 'string') {
      return stampLeaf(parseValue((node as AnyNode).value as string), kind, fields);
    }
    const raw = slice(ctx, node);
    if (raw !== undefined) return stampLeaf(parseValue(raw), kind, fields);
  }
  return null;
}

/* --------------------------------------------------------------- mixins */

/**
 * [guards] Bridge one mixin param. A `VarDeclaration` is a binding (optionally
 * with a default); a `Rest` is variadic `...`; anything else (Keyword / Num /
 * Dimension / Color) is a literal PATTERN param the arg must equal. A list
 * pattern (`Paren` wrapping a `List`) is deferred.
 */
function mixinParams(ctx: BridgeCtx, params: unknown): t2.Param[] {
  if (params === undefined || params === null) return [];
  const arr = isNode(params) ? (params as AnyNode).value : params;
  if (!Array.isArray(arr)) throw new UnsupportedShape('mixin:params-shape', typeOf(params));
  const out: t2.Param[] = [];
  for (const p of arr) {
    if (!isNode(p)) throw new UnsupportedShape('mixin:param', typeOf(p));
    const t = typeOf(p);
    if (t === 'VarDeclaration') {
      const name = (p as AnyNode).name;
      if (typeof name !== 'string') throw new UnsupportedShape('mixin:param-name', typeOf(name));
      const rawDefault = (p as AnyNode).value;
      let def: t2.ValueNode | undefined;
      if (isNode(rawDefault) && typeOf(rawDefault) !== 'Nil') {
        // a detached-ruleset default (`@a: {}`) bridges structurally.
        const computed = toComputedValue(ctx, rawDefault);
        if (computed !== null) def = computed;
        else {
          const dtext = slice(ctx, rawDefault);
          if (dtext !== undefined) def = parseValue(dtext);
        }
      }
      out.push({ name: name.replace(/^@/, ''), default: def });
    } else if (t === 'Rest') {
      // `...` (anonymous) or `@rest...` (named). `.value` is '' or the name.
      const restName = (p as AnyNode).value;
      out.push({ rest: true, name: typeof restName === 'string' && restName ? restName : undefined });
    } else if (t === 'Paren') {
      throw new UnsupportedShape('mixin:list-pattern', t);
    } else {
      // Literal-value pattern param (`.m(dark)`, `.m(2px)`).
      const pat = toOperand(ctx, p);
      if (pat === null) throw new UnsupportedShape('mixin:pattern-param', t);
      out.push({ pattern: pat });
    }
  }
  return out;
}

/** [guards] A single call argument value (computed / variable / literal). */
function argValue(ctx: BridgeCtx, node: unknown): t2.ValueNode {
  const v = toOperand(ctx, node);
  if (v === null) throw new UnsupportedShape('call:arg', typeOf(node));
  return v;
}

/**
 * [guards] Bridge call args. A `VarDeclaration` arg is a NAMED argument
 * (`.m(@b: 2)`); everything else is positional.
 */
function callArgs(ctx: BridgeCtx, args: unknown): t2.CallArg[] {
  if (args === undefined || args === null) return [];
  const arr = isNode(args) ? (args as AnyNode).value : args;
  if (!Array.isArray(arr)) throw new UnsupportedShape('call:args-shape', typeOf(args));
  return arr.map((a) => {
    if (isNode(a) && typeOf(a) === 'VarDeclaration') {
      const name = (a as AnyNode).name;
      if (typeof name !== 'string') throw new UnsupportedShape('call:named-arg', typeOf(name));
      return { name: name.replace(/^@/, ''), value: argValue(ctx, (a as AnyNode).value) };
    }
    return { value: argValue(ctx, a) };
  });
}

/* ----------------------------------------------------------------- guards */

const GUARD_CMP_OPS = new Set(['>', '<', '>=', '<=', '=']); // [guards]

/**
 * [guards] Bridge a parsed Less mixin guard (`when (...)`) into tree2's own
 * `GuardNode` structure. tree2 owns the boolean structure (and/or/not/truth/
 * default) and delegates only leaf comparison/function truth to the service.
 */
function bridgeGuard(ctx: BridgeCtx, node: unknown): t2.GuardNode {
  if (!isNode(node)) throw new UnsupportedShape('guard', typeOf(node));
  const t = typeOf(node);
  switch (t) {
    case 'Condition': {
      const op = (node as AnyNode).operator;
      const negate = (node as AnyNode).negate === true;
      let g: t2.GuardNode;
      if (op === 'and' || op === 'or') {
        g = { g: op, left: bridgeGuard(ctx, (node as AnyNode).left), right: bridgeGuard(ctx, (node as AnyNode).right) };
      } else if (typeof op === 'string' && GUARD_CMP_OPS.has(op)) {
        const left = toOperand(ctx, (node as AnyNode).left);
        const right = toOperand(ctx, (node as AnyNode).right);
        if (left === null || right === null) throw new UnsupportedShape('guard:cmp-operand', op);
        g = { g: 'cmp', op, left, right };
      } else if (op === undefined || op === null) {
        // Unary wrapper: just its single operand (negation applied below).
        g = bridgeGuard(ctx, (node as AnyNode).left);
      } else {
        throw new UnsupportedShape('guard:operator', String(op));
      }
      return negate ? { g: 'not', inner: g } : g;
    }
    case 'Paren':
      return bridgeGuard(ctx, (node as AnyNode).value);
    case 'Call': {
      const name = mixinName(node as AnyNode);
      const { args } = bridgeFnArgs(ctx, (node as AnyNode).args);
      return { g: 'call', name, args };
    }
    case 'DefaultGuard':
      return { g: 'default' };
    default: {
      // Truthiness of a bare value (keyword `true`/`false`, `@ref`, number...).
      const v = toOperand(ctx, node);
      if (v === null) throw new UnsupportedShape('guard:truth', t);
      return { g: 'truth', value: v };
    }
  }
}

function mixinName(node: AnyNode): string {
  const n = node.name;
  if (typeof n === 'string') return n;
  // Call.name is a Reference node with `.key`.
  if (isNode(n)) {
    const key = (n as AnyNode).key;
    if (typeof key === 'string') return key;
    // Reference key may be an object { key }.
    if (isNode(key) && typeof (key as AnyNode).key === 'string') return (key as AnyNode).key as string;
  }
  throw new UnsupportedShape('mixin:name', typeOf(n));
}

/* ---------------------------------------------------------- statements */

/* -------------------------------------------------------------- at-rules */

/**
 * Prelude BYTES of an at-rule. A prelude node's own provenance span is
 * unreliable (it often reports the whole at-rule span), so the header text is
 * recovered from source directly: everything between the name and the block's
 * `{` (block form) or the trailing `;` / end (statement form). When the parser
 * gives a plain string prelude, that is authoritative and used as-is.
 */
function atRuleHeaderPrelude(
  ctx: BridgeCtx,
  node: AnyNode,
  name: string,
  isBlock: boolean,
): string | undefined {
  const prelude = node.prelude;
  if (prelude === undefined || prelude === null || prelude === '') return undefined;
  if (typeof prelude === 'string') {
    const trimmed = prelude.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const span = sourceSpanOf(node);
  if (!span) return undefined;
  const full = ctx.source.slice(span.start, span.end);
  if (!full.startsWith(name)) return undefined;
  let rest = full.slice(name.length);
  if (isBlock) {
    const brace = rest.indexOf('{');
    if (brace >= 0) rest = rest.slice(0, brace);
  } else {
    rest = rest.replace(/;\s*$/u, '');
  }
  rest = rest.trim();
  return rest.length > 0 ? rest : undefined;
}

function toAtRuleBlock(ctx: BridgeCtx, node: AnyNode): t2.AtRuleBlock {
  const name = node.name;
  if (typeof name !== 'string') throw new UnsupportedShape('atrule:name', typeOf(name));
  const preludeText = atRuleHeaderPrelude(ctx, node, name, true);
  // A block at-rule body is itself a nesting boundary; nested at-rules ARE
  // allowed (they stay nested — no bubbling between at-rules), so allowAtRules
  // stays true for the recursive body.
  const body = toBody(ctx, node.rules, true);
  const prelude = preludeText === undefined ? null : parseValue(preludeText);
  return t2.atRuleBlock(name, prelude, body);
}

function toAtRuleStatement(ctx: BridgeCtx, node: AnyNode): t2.AtRuleStatement {
  const name = node.name;
  if (typeof name !== 'string') throw new UnsupportedShape('atrule-statement:name', typeOf(name));
  const preludeText = atRuleHeaderPrelude(ctx, node, name, false);
  return t2.atRuleStatement(name, preludeText === undefined ? null : t2.any(preludeText));
}

/**
 * [charset] Split a `@charset "utf-8";` source token into (keyword, prelude
 * bytes) and build a statement-form at-rule. The keyword casing is preserved
 * from source; the trailing `;` is dropped (re-emitted by the serializer).
 */
function charsetStatement(text: string): t2.AtRuleStatement {
  const m = /^\s*(@[^\s;]*)\s*([^;]*?)\s*;?\s*$/u.exec(text);
  const name = m?.[1] ?? '@charset';
  const prelude = m?.[2] ?? '';
  return t2.atRuleStatement(name, prelude.length > 0 ? t2.any(prelude) : null);
}

function toStatement(
  ctx: BridgeCtx,
  node: unknown,
  allowAtRules: boolean,
): t2.Statement | t2.Statement[] | null {
  if (!isNode(node)) throw new UnsupportedShape('statement', typeOf(node));
  const t = typeOf(node);
  switch (t) {
    // [import] resolve + inline the imported file's bridged statements here.
    case 'StyleImport':
      return resolveImportStatements(
        node as AnyNode,
        ctx.filePath,
        ctx.importState,
        (source, filePath, state) => bridgeToAstBody(source, filePath, state),
        (feature, detail) => {
          throw new UnsupportedShape(feature, detail);
        },
      );
    case 'Declaration': {
      const rawName = (node as AnyNode).name;
      // property name may be an interpolation template (`@{prefix}width`).
      let name: string | t2.Interp;
      if (typeof rawName === 'string') name = rawName;
      else if (isNode(rawName) && typeOf(rawName) === 'Interpolated')
        name = interpFromInterpolated(ctx, rawName as AnyNode, false);
      else throw new UnsupportedShape('decl:name', typeOf(rawName));
      // merge (`+`/`+_`) + structured `!important` recovered from source.
      const { merge, important } = detectMergeImportant(ctx, node as AnyNode);
      // Prefer a structured computed value (function call / operation / interp);
      // fall back to raw-bytes capture for plain static / variable-only values.
      const computed = toComputedValue(ctx, (node as AnyNode).value);
      let value = computed ?? parseValue(rawDeclValue(ctx, node as AnyNode));
      // for a merged decl carrying `!important` in its raw bytes, strip it
      // (the structured flag re-emits it once at the end of the combined line).
      if (merge !== null && important) value = stripImportantBytes(value);
      return t2.decl(name, value, merge, important);
    }
    // [WS2] a custom-property declaration (`--x: …;`). CustomDeclaration extends
    // Declaration (same `name`/`value` source shape) but its value is kept
    // VERBATIM (v5 leaves custom properties unaltered) with only `@{…}`
    // interpolation resolved — no computed function/operation eval, bare `@var`
    // stays literal, and inline `!important` rides along in the bytes.
    case 'CustomDeclaration': {
      const rawName = (node as AnyNode).name;
      let name: string | t2.Interp;
      if (typeof rawName === 'string') name = rawName;
      else if (isNode(rawName) && typeOf(rawName) === 'Interpolated')
        name = interpFromInterpolated(ctx, rawName as AnyNode, false);
      else throw new UnsupportedShape('custom-decl:name', typeOf(rawName));
      return t2.decl(name, customDeclValue(ctx, node as AnyNode), null, false);
    }
    case 'VarDeclaration': {
      const name = (node as AnyNode).name;
      if (typeof name !== 'string') throw new UnsupportedShape('var-decl:name', typeOf(name));
      // a detached-ruleset value (`@rs: { … }`, parser: nameless Mixin). A
      // `!important` variable value keeps `!important` in its bytes (VarDeclarations
      // emit nothing; the flag surfaces only where the variable is referenced).
      const computed = toComputedValue(ctx, (node as AnyNode).value);
      return t2.varDecl(name, computed ?? parseValue(rawDeclValue(ctx, node as AnyNode)));
    }
    // a detached-ruleset call statement (`@rs();`): an Expression wrapping a
    // Call whose callee is a variable Reference.
    case 'Expression': {
      const detached = detachedCallFromExpression(ctx, node as AnyNode);
      if (detached !== null) return detached;
      throw new UnsupportedShape('statement', t);
    }
    case 'Comment': {
      // A comment node's source SPAN is over-wide: the parser reports the
      // ENCLOSING scope span (a root block comment spans `[0 … end-of-document]`),
      // so slicing it would re-dump every preceding `@var`/mixin/rule verbatim —
      // O(n²) blowup (193 comments in benchmark.less → a ~6.1 MB render). The
      // node's `.value` carries the EXACT comment text (`/* … */` incl. multi-line
      // bytes, or `// …`), so use it verbatim. A `//` line comment is dropped
      // (Less drops them).
      const val = (node as AnyNode).value;
      if (typeof val === 'string') {
        if (val.startsWith('//')) return null;
        return t2.comment(val);
      }
      // Fallback: no usable `.value` string — recover from the (narrow) span.
      const raw = slice(ctx, node);
      if (raw === undefined) throw new UnsupportedShape('comment:no-span', '');
      if (raw.startsWith('//')) return null;
      return t2.comment(raw);
    }
    // [WS4] A `Rules` wrapper pairs one or more standalone `Extend` nodes with
    // the `Ruleset` they attach to. The parser emits this shape when a
    // multi-selector group carries a `:extend()` on only SOME of its selectors
    // (`.should-not-exist, .ext7:extend(.ext5 all) {}`): the extend's SUBJECT is
    // that one selector (`Extend.selector`), not the whole group. Bridge the
    // inner ruleset(s) normally (empty bodies drop out), and turn each
    // standalone Extend into a subject-scoped extend Rule.
    case 'Rules': {
      const inner = (node as AnyNode).rules;
      if (!Array.isArray(inner)) throw new UnsupportedShape('statement', t);
      const out: t2.Statement[] = [];
      for (const child of inner) {
        if (isNode(child) && typeOf(child) === 'Extend') {
          out.push(extendSubjectRule(ctx, child as AnyNode));
          continue;
        }
        const s = toStatement(ctx, child, allowAtRules);
        if (Array.isArray(s)) out.push(...s);
        else if (s !== null) out.push(s);
      }
      return out;
    }
    case 'Ruleset':
      return toRuleset(ctx, node as AnyNode);
    case 'Mixin':
      return toMixinDef(ctx, node as AnyNode);
    case 'Call':
      return toMixinCall(ctx, node as AnyNode);
    // [atrule][WS1] block + statement at-rules. A nested at-rule (directly inside
    // a ruleset or mixin body) is kept as a normal child AtRule node of the
    // tree2 body — NO throw, NO hoist/mutation here. The serializer owns v5
    // bubbling (projecting it to root); the bridge's contract is only that the
    // AtRule node is present in the body. `allowAtRules` no longer gates
    // construction (at-rules are valid everywhere the parser produced them).
    case 'AtRule':
      return toAtRuleBlock(ctx, node as AnyNode);
    case 'AtRuleStatement':
      return toAtRuleStatement(ctx, node as AnyNode);
    // [charset] A mid-document `@charset "utf-8";` parses as a role-'charset'
    // `Any` token (its `.value` is the full source slice). It is a document-
    // prelude construct: the tree2 serializer HOISTS the first to the top of the
    // output and DROPS (dedupes) every other one — matching legacy jess / Less
    // 4.x. Model it as a statement-form at-rule; the serializer owns the hoist.
    case 'Any': {
      const anyNode = node as AnyNode;
      if (anyNode.role === 'charset' && typeof anyNode.value === 'string') {
        return charsetStatement(anyNode.value);
      }
      throw new UnsupportedShape('statement', t);
    }
    default:
      throw new UnsupportedShape('statement', t);
  }
}

function toBody(ctx: BridgeCtx, rules: unknown, allowAtRules: boolean): t2.Statement[] {
  if (!Array.isArray(rules)) throw new UnsupportedShape('body', typeOf(rules));
  const out: t2.Statement[] = [];
  for (const r of rules) {
    const s = toStatement(ctx, r, allowAtRules);
    // [import] a StyleImport bridges to MANY statements (its inlined body).
    if (Array.isArray(s)) out.push(...s);
    else if (s !== null) out.push(s);
  }
  return out;
}

/* --------------------------------------------------------------- [extend] */

/**
 * [extend] Build the tree2 target complexes of one `Extend.target`. The parser
 * represents a target as a string (`.error`), a CompoundSelector / ComplexSelector
 * / AttributeSelector node, a SelectorList node, or a JS array (multi-target
 * `:extend(.aa, .bb)`). Each branch becomes one tree2 Complex.
 */
function extendTargetComplexes(ctx: BridgeCtx, target: unknown): t2.Complex[] {
  if (Array.isArray(target)) {
    return target.flatMap((t) => extendTargetComplexes(ctx, t));
  }
  if (isNode(target) && Array.isArray((target as AnyNode).value) && isSelectorListNode(target)) {
    return ((target as AnyNode).value as unknown[]).flatMap((t) => extendTargetComplexes(ctx, t));
  }
  return [toComplex(ctx, target)];
}

/** [extend] An interpolated (`[data=@{x}]`) target is DEFERRED — raise fail-loud. */
function guardExtendTargetSupported(ctx: BridgeCtx, node: AnyNode, target: unknown): void {
  const raw = isNode(target) ? slice(ctx, target) : typeof target === 'string' ? target : undefined;
  const text = raw ?? slice(ctx, node);
  if (text !== undefined && text.includes('@{')) {
    throw new UnsupportedShape('extend:interpolated-target', text);
  }
  // Reference-import extend is DEFERRED. The Extend node carries no reliable
  // reference marker here; the fixtures in scope use no reference imports, so no
  // detection is wired — a reference extend surfaces as a byte diff, not a fake.
}

/**
 * [extend] Pull `Extend` nodes out of a ruleset's `rules`. Returns the extracted
 * instructions (never emitted as body statements) and the remaining rule nodes.
 * An `Extend` is `flag===0` for `all` (partial) and `flag===1` for exact; a
 * multi-target fans into one instruction per branch.
 */
function extractExtends(
  ctx: BridgeCtx,
  rules: unknown[],
): { instructions: t2.ExtendInstruction[]; rest: unknown[] } {
  const instructions: t2.ExtendInstruction[] = [];
  const rest: unknown[] = [];
  for (const r of rules) {
    if (isNode(r) && typeOf(r) === 'Extend') {
      const node = r as AnyNode;
      const target = node.target;
      guardExtendTargetSupported(ctx, node, target);
      const partial = node.flag === 0;
      for (const complex of extendTargetComplexes(ctx, target)) {
        instructions.push({ target: t2.selist(complex), partial });
      }
    } else {
      rest.push(r);
    }
  }
  return { instructions, rest };
}

/**
 * [WS4] Build a subject-scoped extend Rule from a standalone `Extend` node (one
 * whose `.selector` is the extending subject and `.target` the find selector).
 * The carrying Rule's own selector list IS the extend subject in tree2's model,
 * so the subject selector becomes an empty-body Rule bearing the instruction —
 * the empty body drops from output while the instruction fires the extend.
 */
function extendSubjectRule(ctx: BridgeCtx, node: AnyNode): t2.Rule {
  const target = node.target;
  guardExtendTargetSupported(ctx, node, target);
  const partial = node.flag === 0;
  const instructions: t2.ExtendInstruction[] = extendTargetComplexes(ctx, target).map((complex) => ({
    target: t2.selist(complex),
    partial,
  }));
  return t2.rule(toSelectorList(ctx, node.selector), [], instructions);
}

function toRuleset(ctx: BridgeCtx, node: AnyNode): t2.Rule {
  if ((node as AnyNode).guard) throw new UnsupportedShape('guard', 'ruleset-guard');
  const sel = toSelectorList(ctx, node.selector);
  // [extend] hoist `:extend()` instructions out of the body; the rest bridges as
  // normal body statements.
  const rules = Array.isArray(node.rules) ? node.rules : [];
  const { instructions, rest } = extractExtends(ctx, rules);
  // [atrule] at-rules directly under a ruleset bubble in v5 (deferred) — reject.
  const body = toBody(ctx, rest, false);
  return t2.rule(sel, body, instructions.length > 0 ? instructions : undefined);
}

function toMixinDef(ctx: BridgeCtx, node: AnyNode): t2.MixinDef {
  const name = mixinName(node);
  const params = mixinParams(ctx, node.params);
  // [atrule] at-rules inside a mixin body bubble at the call site (deferred) — reject.
  const body = toBody(ctx, node.rules, false);
  const guard = node.guard ? bridgeGuard(ctx, node.guard) : undefined; // [guards]
  return t2.mixinDef(name, params, body, guard);
}

function toMixinCall(ctx: BridgeCtx, node: AnyNode): t2.MixinCall | t2.DetachedCall {
  if (node.contentNode) throw new UnsupportedShape('mixin:content', 'call-content');
  // a call whose callee is a variable (`@rs()`) is a detached-ruleset call.
  const varName = callVarName(ctx, node);
  if (varName !== null && (node.args === undefined || node.args === null)) {
    return t2.detachedCall(varName);
  }
  const rawName = mixinName(node);
  // a namespaced call (`#ns > .b()`, `#ns .b .c()`) descends a path; the
  // parser flattens the path into the name key (combinators embedded). Split it.
  const { path, name } = splitNamespacePath(rawName);
  const args = callArgs(ctx, node.args);
  // `.m() !important` (recovered from source — the parser drops it).
  const callSrc = slice(ctx, node);
  const important = callSrc !== undefined && /!\s*important\s*;?\s*$/iu.test(callSrc);
  return { type: 'MixinCall', name, args, path, important };
}

/** The variable name if a Call's callee is a variable Reference (Keyword
 * key), else null (a selector-keyed mixin/namespace call). */
function callVarName(ctx: BridgeCtx, callNode: AnyNode): string | null {
  const nm = callNode.name;
  if (isNode(nm) && typeOf(nm) === 'Reference') {
    const key = (nm as AnyNode).key;
    if (isNode(key) && typeOf(key) === 'Keyword' && typeof (key as AnyNode).value === 'string') {
      return (key as AnyNode).value as string;
    }
  }
  return null;
}

/** A detached-ruleset call from an `Expression` wrapping a variable `Call`. */
function detachedCallFromExpression(ctx: BridgeCtx, node: AnyNode): t2.DetachedCall | null {
  const val = node.value;
  if (!isNode(val) || typeOf(val) !== 'Call') return null;
  const callNode = val as AnyNode;
  if (callNode.contentNode) return null;
  const varName = callVarName(ctx, callNode);
  if (varName === null) return null;
  if (callNode.args !== undefined && callNode.args !== null) return null;
  return t2.detachedCall(varName);
}

/**
 * Split a parser mixin-call key into a namespace path + final mixin name.
 * The parser flattens `#ns > .b` to `#ns>.b` and `#ns .b .c` to `#ns.b.c`
 * (descendant spaces stripped). A key with an EXPLICIT `>` combinator, or a
 * leading `#namespace` id followed by class segments, is a namespace descent;
 * everything else stays a flat name (`path: []`, byte-unchanged dispatch).
 */
function splitNamespacePath(key: string): { path: t2.PathSeg[]; name: string } {
  // Only `>`-separated paths are unambiguous from the flattened key; treat those
  // as namespace descents. (Descendant-space paths collapse to a bare compound in
  // the parser key and are indistinguishable from a compound mixin name, so they
  // stay flat — a known bridge limitation, tracked as a deferred namespace case.)
  if (!key.includes('>')) return { path: [], name: key };
  const segs = key.split('>').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segs.length < 2) return { path: [], name: key };
  const name = segs[segs.length - 1]!;
  const path: t2.PathSeg[] = segs.slice(0, -1).map((sel) => ({ comb: '>' as t2.Combinator, sel }));
  // The final segment's own combinator to its parent is `>`; represented via the
  // path already. Descent frames match each `sel` by own-local canonical string.
  return { path, name };
}

/** Recover the `+`/`+_` merge marker + structured `!important` from a
 * declaration's source (the parser drops both from the tree). */
function detectMergeImportant(ctx: BridgeCtx, node: AnyNode): { merge: null | ',' | ' '; important: boolean } {
  const declText = slice(ctx, node);
  if (declText === undefined) return { merge: null, important: false };
  const body = declText.replace(/;\s*$/u, '');
  const colon = body.indexOf(':');
  if (colon < 0) return { merge: null, important: false };
  const namePart = body.slice(0, colon).replace(/\s+$/u, '');
  let merge: null | ',' | ' ' = null;
  if (namePart.endsWith('+_')) merge = ' ';
  else if (namePart.endsWith('+')) merge = ',';
  const important = /!\s*important\s*$/iu.test(body);
  return { merge, important };
}

/** Strip a trailing `!important` from a value node's bytes (merged decls
 * re-emit it once via the structured flag). */
function stripImportantBytes(v: t2.ValueNode): t2.ValueNode {
  if (t2.isLiteralNode(v)) {
    return t2.any(v.src.replace(/\s*!\s*important\s*$/iu, ''));
  }
  return v;
}

/* --------------------------------------------------------------- entry */

/**
 * Bridge a parsed Less `tree` root (`Rules`) into a tree2 `Root`. Throws
 * `UnsupportedShape` on the first shape tree2 does not yet cover.
 *
 * [import] `filePath` (the absolute path of the source file) enables `@import`
 * resolution relative to it, and `importState` carries the once-dedup/cycle set
 * across the whole recursive run. Both are optional so existing call sites
 * (import-free fixtures) are unaffected.
 */
export function bridgeToAst(
  root: unknown,
  source: string,
  filePath?: string,
  importState?: ImportState,
): t2.Root {
  const ctx: BridgeCtx = { source, filePath, importState: importState ?? createImportState(parseLessFn) };
  if (!isNode(root)) throw new UnsupportedShape('root', typeOf(root));
  const rules = (root as AnyNode).rules;
  if (!Array.isArray(rules)) throw new UnsupportedShape('root:rules', typeOf(rules));
  // [atrule] at-rules are valid at the document root.
  return t2.root(toBody(ctx, rules, true));
}

/**
 * [import] Parse + bridge an imported file's SOURCE into its top-level tree2
 * statements (the recursion the import bridge splices at the call site). Parsing
 * is the shared front end; this keeps the parser dependency here in bridge.ts.
 */
function bridgeToAstBody(source: string, filePath: string, state: ImportState): t2.Statement[] {
  const parsed = parseLessFn(source);
  if (parsed.errors.length > 0) {
    throw new UnsupportedShape('import:parse-error', filePath);
  }
  const root = parsed.tree as unknown;
  if (!isNode(root)) throw new UnsupportedShape('import:root', typeOf(root));
  const rules = (root as AnyNode).rules;
  if (!Array.isArray(rules)) throw new UnsupportedShape('import:root-rules', typeOf(rules));
  const ctx: BridgeCtx = { source, filePath, importState: state };
  // Imported file top level is a document root — at-rules are valid.
  return toBody(ctx, rules, true);
}
