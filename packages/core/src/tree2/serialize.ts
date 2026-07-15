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
import { Word } from './nodes.js';
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
import type { ValueService } from './value-service.js';

export interface Tree2Position {
  node: Tree2Node;
  kind: Kind;
  start: number;
  end: number;
}

export interface SerializeOptions {
  trackPositions?: boolean;
  /**
   * Injected value-eval service (the boundary-safe seam). When present, tree2's
   * `Operation` / `FunctionCall` value nodes are COMPUTED through it; when
   * absent they fall back to un-evaluated source assembly (tree2 does no math
   * itself). tree2 depends only on the `ValueService` interface.
   */
  valueService?: ValueService;
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

/**
 * Collect variable declarations in a scope. Less variable semantics: LAST-wins
 * within a scope (a later `@x` overrides an earlier one) and LAZY (a reference
 * can resolve a variable declared textually later in the same scope). Building
 * the whole scope's var map up-front — before any value is emitted — gives both
 * for free: `set` overwrites (last-wins) and the map is complete before use.
 */
function collectVars(statements: Statement[]): Map<string, ValueNode> | null {
  let map: Map<string, ValueNode> | null = null;
  for (const s of statements) {
    if (s.kind === Kind.VarDeclaration) {
      (map ??= new Map()).set(s.name, s.value);
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

/**
 * Bind call args to params. Args are evaluated EAGERLY in the CALLER's frame
 * (Less evaluates mixin arguments in the caller scope) and stored as resolved
 * literals, so an arg like `@c` resolves against the caller — never re-resolved
 * against the callee's scope (which would find the wrong binding or loop).
 */
function bindParams(
  params: Param[],
  args: ValueNode[],
  callerFrame: Frame | null,
  service: ValueService | null,
): Map<string, ValueNode> | null {
  if (params.length === 0) return null;
  const vars = new Map<string, ValueNode>();
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    const v = i < args.length ? args[i]! : p.default;
    if (v !== undefined) vars.set(p.name, new Word(valueText(v, callerFrame, service)));
  }
  return vars;
}

/* ----------------------------------------------------------- value bytes */

const MAX_VAR_DEPTH = 64;

function valueText(
  node: ValueNode,
  frame: Frame | null,
  service: ValueService | null,
  depth = 0,
): string {
  switch (node.kind) {
    case Kind.Word:
      return node.text;
    case Kind.Dimension:
      return `${node.value}${node.unit}`;
    case Kind.VarRef: {
      if (depth > MAX_VAR_DEPTH) return `@${node.name}`; // cycle guard
      const bound = lookupVar(frame, node.name);
      // Unbound: emit the byte form so the output visibly diverges rather than
      // silently dropping (a real fixture that reaches here needs another rung).
      return bound ? valueText(bound, frame, service, depth + 1) : `@${node.name}`;
    }
    case Kind.Concat: {
      let out = '';
      for (const part of node.parts) out += valueText(part, frame, service, depth);
      return out;
    }
    case Kind.SpacedValue: {
      const parts = node.parts;
      let out = parts.length > 0 ? valueText(parts[0]!, frame, service, depth) : '';
      for (let i = 1; i < parts.length; i++) out += ' ' + valueText(parts[i]!, frame, service, depth);
      return out;
    }
    case Kind.Paren: {
      // Transparent to computed bytes: a parenthesized operation is evaluated by
      // the service (which strips the paren), matching the legacy oracle. With
      // no service, keep the parens for faithful un-evaluated source.
      const inner = valueText(node.inner, frame, service, depth);
      return service ? inner : `(${inner})`;
    }
    case Kind.Operation: {
      // Operands are serialized to their UN-EVALUATED, variable-resolved SOURCE
      // (null service): only the OUTERMOST computed node in an emitted value
      // calls the service, handing it the full (possibly nested) expression
      // source. That keeps the service call site deterministic (a nested op is
      // never separately computed), so precedence is carried by the source and
      // the record/replay key is identical across passes.
      const left = valueText(node.left, frame, null, depth);
      const right = valueText(node.right, frame, null, depth);
      return service
        ? service.evaluateOperation(node.operator, left, right)
        : `${left} ${node.operator} ${right}`;
    }
    case Kind.FunctionCall: {
      // `args` serializes to the (variable-resolved) inner argument SOURCE; the
      // service performs the call and returns computed bytes.
      const args = valueText(node.args, frame, null, depth);
      return service ? service.callFunction(node.name, args) : `${node.name}(${args})`;
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
  service: ValueService | null;
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
  const e: Emit = {
    chunks: [],
    off: 0,
    positions: options?.trackPositions ? [] : null,
    service: options?.valueService ?? null,
  };
  const rootFrame: Frame = {
    parent: null,
    mixins: collectMixins(root.children),
    vars: collectVars(root.children),
  };
  const start = e.off;
  for (const child of root.children) {
    switch (child.kind) {
      case Kind.Rule:
        flatten(child, null, rootFrame, e);
        break;
      case Kind.MixinDef:
      case Kind.VarDeclaration:
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
  const childFrame: Frame = {
    parent: frame,
    mixins: collectMixins(rule.body),
    vars: collectVars(rule.body),
  };
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
      case Kind.VarDeclaration:
        break;
    }
  }
}

/** Merge param bindings and body-local vars into one frame map (params first). */
function mergeVars(
  a: Map<string, ValueNode> | null,
  b: Map<string, ValueNode> | null,
): Map<string, ValueNode> | null {
  if (!a) return b;
  if (!b) return a;
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, v);
  return out;
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
    vars: mergeVars(bindParams(def.params, call.args, frame, e.service), collectVars(def.body)),
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
    put(e, valueText(node.value, frame, e.service));
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
            vars: mergeVars(bindParams(def.params, node.args, frame, null), collectVars(def.body)),
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
