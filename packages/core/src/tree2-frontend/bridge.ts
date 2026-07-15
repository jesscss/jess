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
 * Supported shapes (rungs 1-5): rules, selector lists / compound / combinators,
 * nesting + `&`, static/spaced declarations (incl. `!important`), mixin
 * definition (`.m() {}`) with positional params, mixin call (`.m()`). Anything
 * else raises `UnsupportedShape`, which the census collects and ranks.
 */

import * as t2 from '../tree2/index.js';
import type { Combinator } from '../tree2/index.js';
import { sourceSpanOf } from '../tree/util/provenance.js';

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
}

/** A tree node is any object; we read its structural fields defensively. */
type AnyNode = Record<string, unknown> & { type?: unknown };

function isNode(x: unknown): x is AnyNode {
  return !!x && typeof x === 'object';
}

function typeOf(x: unknown): string {
  if (typeof x === 'string') return 'string';
  if (isNode(x)) return String((x as AnyNode).type ?? (x as { constructor?: { name?: string } }).constructor?.name ?? 'unknown');
  return typeof x;
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
      // A bare `&`, or `&`-with-append (`&-foo`). Append is not yet supported.
      const appendValue = (el as AnyNode).appendValue;
      if (appendValue !== undefined && appendValue !== null && appendValue !== '') {
        throw new UnsupportedShape('selector:ampersand-append', String(appendValue));
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

/** Build a tree2 Compound from a CompoundSelector node or a bare string. */
function toCompound(ctx: BridgeCtx, sel: unknown): t2.Compound {
  if (typeof sel === 'string') return t2.compound(sel);
  if (isNode(sel) && typeOf(sel) === 'CompoundSelector') {
    const parts = (sel as AnyNode).value;
    if (!Array.isArray(parts)) throw new UnsupportedShape('selector:compound-shape', typeOf(sel));
    return t2.compound(...parts.map((p) => simpleText(ctx, p)));
  }
  // A single simple node (e.g. Ampersand alone, PseudoSelector alone).
  return t2.compound(simpleText(ctx, sel));
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
      let first = true;
      for (const item of items) {
        if (typeof item === 'string' && COMBINATORS.has(item)) {
          pendingComb = item as Combinator;
          continue;
        }
        if (first) {
          segments.push({ compound: toCompound(ctx, item) });
          first = false;
        } else {
          segments.push({ comb: pendingComb, compound: toCompound(ctx, item) });
          pendingComb = ' ';
        }
      }
      if (segments.length === 0) throw new UnsupportedShape('selector:complex-empty', t);
      return t2.complex(segments);
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
 * Tokenize static value bytes into a tree2 value, turning `@name` references
 * into `VarRef` nodes and leaving everything else literal. Reference
 * substitution only — `@{interp}` (no `[A-Za-z_]` after `@`) is left literal
 * (interpolation is a later rung), and no arithmetic/functions are parsed.
 */
function parseValue(text: string): t2.ValueNode {
  if (text.indexOf('@') < 0) return t2.word(text);
  const re = /@([A-Za-z_][\w-]*)/g;
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

/* --------------------------------------------------------------- mixins */

function mixinParams(ctx: BridgeCtx, params: unknown): t2.Param[] {
  if (params === undefined || params === null) return [];
  // params is a List node whose `.value` is an array of VarDeclaration.
  const arr = isNode(params) ? (params as AnyNode).value : params;
  if (!Array.isArray(arr)) throw new UnsupportedShape('mixin:params-shape', typeOf(params));
  const out: t2.Param[] = [];
  for (const p of arr) {
    if (!isNode(p)) throw new UnsupportedShape('mixin:param', typeOf(p));
    const name = (p as AnyNode).name;
    if (typeof name !== 'string') throw new UnsupportedShape('mixin:param-name', typeOf(name));
    // Default value: a Nil value means no default.
    const rawDefault = (p as AnyNode).value;
    let def: t2.ValueNode | undefined;
    if (isNode(rawDefault) && typeOf(rawDefault) !== 'Nil') {
      const dtext = slice(ctx, rawDefault);
      if (dtext !== undefined) def = parseValue(dtext);
    }
    out.push({ name: name.replace(/^@/, ''), default: def });
  }
  return out;
}

function callArgs(ctx: BridgeCtx, args: unknown): t2.ValueNode[] {
  if (args === undefined || args === null) return [];
  const arr = isNode(args) ? (args as AnyNode).value : args;
  if (!Array.isArray(arr)) throw new UnsupportedShape('call:args-shape', typeOf(args));
  return arr.map((a) => {
    const text = typeof a === 'string' ? a : isNode(a) ? slice(ctx, a) : undefined;
    if (text === undefined) throw new UnsupportedShape('call:arg', typeOf(a));
    return parseValue(text);
  });
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

function toStatement(ctx: BridgeCtx, node: unknown): t2.Statement | null {
  if (!isNode(node)) throw new UnsupportedShape('statement', typeOf(node));
  const t = typeOf(node);
  switch (t) {
    case 'Declaration': {
      const name = (node as AnyNode).name;
      if (typeof name !== 'string') throw new UnsupportedShape('decl:name', typeOf(name));
      return t2.decl(name, parseValue(rawDeclValue(ctx, node as AnyNode)));
    }
    case 'VarDeclaration': {
      const name = (node as AnyNode).name;
      if (typeof name !== 'string') throw new UnsupportedShape('var-decl:name', typeOf(name));
      if ((node as AnyNode).important) throw new UnsupportedShape('var-decl:important', name);
      return t2.varDecl(name, parseValue(rawDeclValue(ctx, node as AnyNode)));
    }
    case 'Comment': {
      const raw = slice(ctx, node);
      if (raw === undefined) throw new UnsupportedShape('comment:no-span', '');
      // Less drops standalone `//` line comments (not valid CSS); block
      // comments `/* … */` are preserved. Match that.
      if (raw.startsWith('//')) return null;
      return t2.comment(raw);
    }
    case 'Ruleset':
      return toRuleset(ctx, node as AnyNode);
    case 'Mixin':
      return toMixinDef(ctx, node as AnyNode);
    case 'Call':
      return toMixinCall(ctx, node as AnyNode);
    default:
      throw new UnsupportedShape('statement', t);
  }
}

function toBody(ctx: BridgeCtx, rules: unknown): t2.Statement[] {
  if (!Array.isArray(rules)) throw new UnsupportedShape('body', typeOf(rules));
  const out: t2.Statement[] = [];
  for (const r of rules) {
    const s = toStatement(ctx, r);
    if (s !== null) out.push(s);
  }
  return out;
}

function toRuleset(ctx: BridgeCtx, node: AnyNode): t2.Rule {
  if ((node as AnyNode).guard) throw new UnsupportedShape('guard', 'ruleset-guard');
  const sel = toSelectorList(ctx, node.selector);
  const body = toBody(ctx, node.rules);
  return new t2.Rule(sel, body);
}

function toMixinDef(ctx: BridgeCtx, node: AnyNode): t2.MixinDef {
  if (node.guard) throw new UnsupportedShape('guard', 'mixin-guard');
  const name = mixinName(node);
  const params = mixinParams(ctx, node.params);
  const body = toBody(ctx, node.rules);
  return t2.mixinDef(name, params, body);
}

function toMixinCall(ctx: BridgeCtx, node: AnyNode): t2.MixinCall {
  if (node.contentNode) throw new UnsupportedShape('mixin:content', 'call-content');
  const name = mixinName(node);
  const args = callArgs(ctx, node.args);
  return t2.mixinCall(name, args);
}

/* --------------------------------------------------------------- entry */

/**
 * Bridge a parsed Less `tree` root (`Rules`) into a tree2 `Root`. Throws
 * `UnsupportedShape` on the first shape tree2 does not yet cover.
 */
export function bridgeToTree2(root: unknown, source: string): t2.Root {
  const ctx: BridgeCtx = { source };
  if (!isNode(root)) throw new UnsupportedShape('root', typeOf(root));
  const rules = (root as AnyNode).rules;
  if (!Array.isArray(rules)) throw new UnsupportedShape('root:rules', typeOf(rules));
  return t2.root(toBody(ctx, rules));
}
