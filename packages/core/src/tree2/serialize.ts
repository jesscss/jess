/**
 * Clean-room tree2 eval + byte-faithful serializer.
 *
 * This is the decisive rung: tree2 does NOT pre-compose a tree and then print
 * it — it PRODUCES the compositions during a single eval+emit walk. The design
 * is departure #4 (canonical-body + placement-overlay):
 *
 *   - A mixin DEFINITION's body is stored ONCE.
 *   - A mixin CALL is a cheap OVERLAY: a binding frame (param -> arg value node)
 *     plus the current parent-selector context. The call expands by WALKING the
 *     shared body in place — no node is cloned, there is no `cloneForPlacement`
 *     / `inherit` analog. Selector composition happens via the interned-string
 *     primitive; declaration values resolve param refs through the frame.
 *
 * So the eval path stays O(placements) with a tiny constant: each placed nested
 * selector costs one interned-string build, each declaration one frame lookup.
 *
 * Scope is intentionally minimal (mixin defs + positional param bindings +
 * static/spaced values + `@param` substitution). Operations, guards, extend,
 * @media, imports, real variable scoping beyond params are deferred rungs.
 *
 * Entry points:
 *   - `serialize(root)`                     — fast path, no position tracking.
 *   - `serialize(root, { trackPositions })` — + node->offset sourcemap map.
 *   - `composeStats(root)`                  — untimed op-count instrumentation.
 */

import { Kind, Tree2Node } from './node.js';
import type {
  Complex,
  MixinCall,
  MixinDef,
  Param,
  Root,
  Rule,
  SelectorList,
  Statement,
  ValueNode,
} from './nodes.js';

export interface Tree2Position {
  node: Tree2Node;
  kind: Kind;
  start: number;
  end: number;
}

export interface SerializeOptions {
  trackPositions?: boolean;
}

export interface SerializeResult {
  css: string;
  /** Present only when `trackPositions` is set. */
  positions?: Tree2Position[];
}

const INDENT = '  ';

/* ------------------------------------------------------------------- scope */

/**
 * A binding frame (the placement overlay). `mixins` holds definitions visible
 * at this level; `vars` holds param bindings for a mixin call. Frames chain to
 * their lexical parent for lookup.
 */
interface Frame {
  parent: Frame | null;
  mixins: Map<string, MixinDef> | null;
  vars: Map<string, ValueNode> | null;
}

function collectMixins(statements: Statement[]): Map<string, MixinDef> | null {
  let map: Map<string, MixinDef> | null = null;
  for (const s of statements) {
    if (s.kind === Kind.MixinDef) {
      (map ??= new Map()).set(s.name, s);
    }
  }
  return map;
}

function lookupMixin(frame: Frame | null, name: string): MixinDef | undefined {
  for (let f = frame; f; f = f.parent) {
    const hit = f.mixins?.get(name);
    if (hit) return hit;
  }
  return undefined;
}

function lookupVar(frame: Frame | null, name: string): ValueNode | undefined {
  for (let f = frame; f; f = f.parent) {
    const hit = f.vars?.get(name);
    if (hit) return hit;
  }
  return undefined;
}

function bindParams(params: Param[], args: ValueNode[]): Map<string, ValueNode> | null {
  if (params.length === 0) return null;
  const vars = new Map<string, ValueNode>();
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    const v = i < args.length ? args[i]! : p.default;
    if (v !== undefined) vars.set(p.name, v);
  }
  return vars;
}

/* ----------------------------------------------------------- value bytes */

function valueText(node: ValueNode, frame: Frame | null): string {
  switch (node.kind) {
    case Kind.Word:
      return node.text;
    case Kind.Dimension:
      return `${node.value}${node.unit}`;
    case Kind.VarRef: {
      const bound = lookupVar(frame, node.name);
      return bound ? valueText(bound, frame) : node.name;
    }
    case Kind.SpacedValue: {
      const parts = node.parts;
      let out = parts.length > 0 ? valueText(parts[0]!, frame) : '';
      for (let i = 1; i < parts.length; i++) out += ' ' + valueText(parts[i]!, frame);
      return out;
    }
  }
}

/* ---------------------------------------------------- selector composition */

function parentToken(parents: string[]): string {
  return parents.length === 1 ? parents[0]! : `:is(${parents.join(', ')})`;
}

function composeOne(parent: string, child: Complex): string {
  const canon = child.canonical();
  if (child.hasAmpersand) return canon.split('&').join(parent);
  return parent + ' ' + canon;
}

function compose(parents: string[], child: SelectorList): string[] {
  const token = parentToken(parents);
  const out: string[] = [];
  for (const c of child.selectors) out.push(composeOne(token, c));
  return out;
}

function ownStrings(list: SelectorList): string[] {
  const out: string[] = [];
  for (const c of list.selectors) out.push(c.canonical());
  return out;
}

/* ------------------------------------------------------------- emit engine */

interface Emit {
  chunks: string[];
  off: number;
  positions: Tree2Position[] | null;
}

function put(e: Emit, s: string): void {
  e.chunks.push(s);
  if (e.positions) e.off += s.length;
}

/** A grouped leaf (declaration/comment) plus the frame its values resolve in. */
interface Leaf {
  node: Statement;
  frame: Frame | null;
}

export function serialize(root: Root, options?: SerializeOptions): SerializeResult {
  const e: Emit = { chunks: [], off: 0, positions: options?.trackPositions ? [] : null };
  const rootFrame: Frame = { parent: null, mixins: collectMixins(root.children), vars: null };
  const start = e.off;
  for (const child of root.children) {
    switch (child.kind) {
      case Kind.Rule:
        flatten(child, null, rootFrame, e);
        break;
      case Kind.MixinDef:
        break; // definitions emit nothing
      case Kind.MixinCall: {
        const group: Leaf[] = [];
        expandCall(child, null, rootFrame, group, () => flushBlock([], group, e), e);
        break;
      }
      case Kind.Declaration:
      case Kind.Comment:
        emitLeaf({ node: child, frame: rootFrame }, e);
        break;
    }
  }
  if (e.positions) e.positions.push({ node: root, kind: root.kind, start, end: e.off });
  return e.positions ? { css: e.chunks.join(''), positions: e.positions } : { css: e.chunks.join('') };
}

function flatten(rule: Rule, parent: string[] | null, frame: Frame, e: Emit): void {
  const composed = parent === null ? ownStrings(rule.selector) : compose(parent, rule.selector);
  const childFrame: Frame = { parent: frame, mixins: collectMixins(rule.body), vars: null };
  const group: Leaf[] = [];
  const flush = (): void => {
    if (group.length) {
      flushBlock(composed, group, e, rule.selector);
      group.length = 0;
    }
  };
  walkBody(rule.body, composed, childFrame, group, flush, e);
  flush();
}

/** Walk a body, expanding mixin calls inline against the shared canonical body. */
function walkBody(
  statements: Statement[],
  composed: string[],
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  e: Emit,
): void {
  for (const node of statements) {
    switch (node.kind) {
      case Kind.Declaration:
      case Kind.Comment:
        group.push({ node, frame });
        break;
      case Kind.Rule:
        flush();
        flatten(node, composed, frame, e);
        break;
      case Kind.MixinCall:
        expandCall(node, composed, frame, group, flush, e);
        break;
      case Kind.MixinDef:
        break;
    }
  }
}

/**
 * Expand a mixin call: bind args, then WALK the shared def body in place under
 * the current composed selector. No clone, no per-placement node build.
 */
function expandCall(
  call: MixinCall,
  composed: string[] | null,
  frame: Frame,
  group: Leaf[],
  flush: () => void,
  e: Emit,
): void {
  const def = lookupMixin(frame, call.name);
  if (!def) return; // unknown mixin: minimal scope emits nothing
  const callFrame: Frame = {
    parent: frame,
    mixins: collectMixins(def.body),
    vars: bindParams(def.params, call.args),
  };
  walkBody(def.body, composed ?? [], callFrame, group, flush, e);
}

function flushBlock(sel: string[], group: Leaf[], e: Emit, selNode?: SelectorList): void {
  const selStart = e.off;
  put(e, sel.join(',\n'));
  if (e.positions && selNode) {
    e.positions.push({ node: selNode, kind: selNode.kind, start: selStart, end: e.off });
  }
  put(e, ' {\n');
  for (const leaf of group) emitLeaf(leaf, e);
  put(e, '}\n');
}

function emitLeaf(leaf: Leaf, e: Emit): void {
  const { node, frame } = leaf;
  const start = e.off;
  if (node.kind === Kind.Declaration) {
    put(e, INDENT);
    put(e, node.name);
    put(e, ': ');
    const valStart = e.off;
    put(e, valueText(node.value, frame));
    if (e.positions) {
      e.positions.push({ node: node.value, kind: node.value.kind, start: valStart, end: e.off });
      e.positions.push({ node, kind: node.kind, start, end: e.off });
    }
    put(e, ';\n');
  } else if (node.kind === Kind.Comment) {
    put(e, INDENT);
    put(e, node.text);
    put(e, '\n');
    if (e.positions) e.positions.push({ node, kind: node.kind, start, end: e.off });
  }
}

/* ---------------------------------------------- composition-op instrumentation */

export interface ComposeStats {
  /** (parent x child) selector compositions performed during eval+emit. */
  composeOps: number;
  /** Selector strings allocated by composition. */
  selectorAllocs: number;
  /** Distinct composed selector strings produced (interning ceiling). */
  distinctSelectors: number;
}

/**
 * Untimed instrumentation: replays the eval+emit walk (including mixin
 * placement) and counts the selector compositions tree2 performs — the leading
 * indicator to compare against legacy `withComponents`/`cloneForPlacement`/
 * `inherit` counts. Kept OUT of the timed path.
 */
export function composeStats(root: Root): ComposeStats {
  const stats: ComposeStats = { composeOps: 0, selectorAllocs: 0, distinctSelectors: 0 };
  const seen = new Set<string>();

  const composeCount = (parents: string[], child: SelectorList): string[] => {
    if (parents.length > 1) stats.selectorAllocs++; // the :is(...) wrap
    const token = parentToken(parents);
    const res: string[] = [];
    for (const c of child.selectors) {
      stats.composeOps++;
      stats.selectorAllocs++;
      const s = composeOne(token, c);
      res.push(s);
      seen.add(s);
    }
    return res;
  };

  const walk = (statements: Statement[], composed: string[], frame: Frame): void => {
    for (const node of statements) {
      if (node.kind === Kind.Rule) {
        walkRule(node, composed, frame);
      } else if (node.kind === Kind.MixinCall) {
        const def = lookupMixin(frame, node.name);
        if (def) {
          const callFrame: Frame = {
            parent: frame,
            mixins: collectMixins(def.body),
            vars: bindParams(def.params, node.args),
          };
          walk(def.body, composed, callFrame);
        }
      }
    }
  };
  const walkRule = (rule: Rule, parent: string[] | null, frame: Frame): void => {
    const composed = parent === null ? ownStrings(rule.selector) : composeCount(parent, rule.selector);
    const childFrame: Frame = { parent: frame, mixins: collectMixins(rule.body), vars: null };
    walk(rule.body, composed, childFrame);
  };

  const rootFrame: Frame = { parent: null, mixins: collectMixins(root.children), vars: null };
  for (const child of root.children) {
    if (child.kind === Kind.Rule) walkRule(child, null, rootFrame);
  }
  stats.distinctSelectors = seen.size;
  return stats;
}
