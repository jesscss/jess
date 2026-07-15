/**
 * Clean-room tree2 byte-faithful serializer with nesting collapse.
 *
 * Reproduces the exact bytes the legacy renderer emits (collapseNesting) for
 * the covered shapes, designed fresh (NOT a re-implementation of `writeSyntax`,
 * and NOT using any `cloneForPlacement` / `inherit` analog).
 *
 * NESTING / `&` COMPOSITION is the cost center this experiment targets. tree2
 * composes a parent selector with a child selector by STRING operations on the
 * cached canonical selector text:
 *   - child references `&`  => substitute the parent string for each `&`
 *   - otherwise             => descendant join `parent + ' ' + child`
 * A `SelectorList` multiplies (each parent x each child). This is one string
 * build per (parent,child) pair — no node tree is rebuilt per placement.
 *
 * Three entry points:
 *   - `serialize(root)`                       — FAST path, no bookkeeping.
 *   - `serialize(root, { trackPositions })`   — + node->offset sourcemap map.
 *   - `composeStats(root)`                    — UNTIMED op-count instrumentation
 *                                               (composition ops / string allocs).
 */

import { Kind, Tree2Node } from './node.js';
import type { Complex, Root, SelectorList, Statement, ValueNode } from './nodes.js';

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

type RuleNode = Statement & { kind: Kind.Rule };

const INDENT = '  ';

/* ----------------------------------------------------------- value bytes */

function valueText(node: ValueNode): string {
  switch (node.kind) {
    case Kind.Word:
      return node.text;
    case Kind.Dimension:
      return `${node.value}${node.unit}`;
    case Kind.SpacedValue: {
      const parts = node.parts;
      let out = parts.length > 0 ? valueText(parts[0]!) : '';
      for (let i = 1; i < parts.length; i++) out += ' ' + valueText(parts[i]!);
      return out;
    }
  }
}

/* ---------------------------------------------------- selector composition */

/**
 * Reduce a parent selector-string list to a single reference token. Less v5
 * wraps a multi-selector parent in `:is(...)` rather than distributing the
 * child across each parent, so `.a, .b` + `.c` => `:is(.a, .b) .c`.
 */
function parentToken(parents: string[]): string {
  return parents.length === 1 ? parents[0]! : `:is(${parents.join(', ')})`;
}

/** Compose one parent reference token with one child complex selector. */
function composeOne(parent: string, child: Complex): string {
  const canon = child.canonical();
  if (child.hasAmpersand) {
    // Substitute the parent for every `&` in the child's canonical text.
    return canon.split('&').join(parent);
  }
  // Descendant nesting.
  return parent + ' ' + canon;
}

/** Compose a parent selector-string list with a child selector list. */
function compose(parents: string[], child: SelectorList): string[] {
  const token = parentToken(parents);
  const out: string[] = [];
  for (const c of child.selectors) {
    out.push(composeOne(token, c));
  }
  return out;
}

/** The own (uncomposed) selector strings for a top-level list. */
function ownStrings(list: SelectorList): string[] {
  const out: string[] = [];
  for (const c of list.selectors) out.push(c.canonical());
  return out;
}

/* -------------------------------------------------------------- fast path */

export function serialize(root: Root, options?: SerializeOptions): SerializeResult {
  if (options?.trackPositions) {
    return serializeTracked(root);
  }
  const out: string[] = [];
  for (const child of root.children) {
    if (child.kind === Kind.Rule) {
      flattenFast(child, null, out);
    } else {
      emitLeafFast(child, '', out);
    }
  }
  return { css: out.join('') };
}

function flattenFast(rule: RuleNode, parent: string[] | null, out: string[]): void {
  const composed = parent === null ? ownStrings(rule.selector) : compose(parent, rule.selector);
  let group: Statement[] = [];
  const flush = (): void => {
    if (group.length) {
      emitBlockFast(composed, group, out);
      group = [];
    }
  };
  for (const child of rule.body) {
    if (child.kind === Kind.Rule) {
      flush();
      flattenFast(child, composed, out);
    } else {
      group.push(child);
    }
  }
  flush();
}

function emitBlockFast(sel: string[], children: Statement[], out: string[]): void {
  out.push(sel.join(',\n'), ' {\n');
  for (const child of children) emitLeafFast(child, INDENT, out);
  out.push('}\n');
}

function emitLeafFast(node: Statement, indent: string, out: string[]): void {
  switch (node.kind) {
    case Kind.Declaration:
      out.push(indent, node.name, ': ', valueText(node.value), ';\n');
      return;
    case Kind.Comment:
      out.push(indent, node.text, '\n');
      return;
    case Kind.Rule:
      flattenFast(node, null, out);
      return;
  }
}

/* ------------------------------------------------------ tracked (sourcemap) */

interface Writer {
  chunks: string[];
  off: number;
  positions: Tree2Position[];
}

function put(w: Writer, s: string): void {
  w.chunks.push(s);
  w.off += s.length;
}

function serializeTracked(root: Root): SerializeResult {
  const w: Writer = { chunks: [], off: 0, positions: [] };
  const start = w.off;
  for (const child of root.children) {
    if (child.kind === Kind.Rule) {
      flattenTracked(child, null, w);
    } else {
      emitLeafTracked(child, '', w);
    }
  }
  w.positions.push({ node: root, kind: root.kind, start, end: w.off });
  return { css: w.chunks.join(''), positions: w.positions };
}

function flattenTracked(rule: RuleNode, parent: string[] | null, w: Writer): void {
  const composed = parent === null ? ownStrings(rule.selector) : compose(parent, rule.selector);
  let group: Statement[] = [];
  const flush = (): void => {
    if (group.length) {
      emitBlockTracked(rule.selector, composed, group, w);
      group = [];
    }
  };
  for (const child of rule.body) {
    if (child.kind === Kind.Rule) {
      flush();
      flattenTracked(child, composed, w);
    } else {
      group.push(child);
    }
  }
  flush();
}

function emitBlockTracked(selList: SelectorList, sel: string[], children: Statement[], w: Writer): void {
  const selStart = w.off;
  put(w, sel.join(',\n'));
  w.positions.push({ node: selList, kind: selList.kind, start: selStart, end: w.off });
  put(w, ' {\n');
  for (const child of children) emitLeafTracked(child, INDENT, w);
  put(w, '}\n');
}

function emitLeafTracked(node: Statement, indent: string, w: Writer): void {
  const start = w.off;
  switch (node.kind) {
    case Kind.Declaration: {
      put(w, indent);
      put(w, node.name);
      put(w, ': ');
      const valStart = w.off;
      put(w, valueText(node.value));
      w.positions.push({ node: node.value, kind: node.value.kind, start: valStart, end: w.off });
      put(w, ';\n');
      break;
    }
    case Kind.Comment:
      put(w, indent);
      put(w, node.text);
      put(w, '\n');
      break;
    case Kind.Rule:
      flattenTracked(node, null, w);
      return;
  }
  w.positions.push({ node, kind: node.kind, start, end: w.off });
}

/* ---------------------------------------------- composition-op instrumentation */

export interface ComposeStats {
  /** Number of (parent x child) selector compositions performed. */
  composeOps: number;
  /** Number of selector strings allocated by composition. */
  selectorAllocs: number;
  /** Distinct composed selector strings produced (interning ceiling). */
  distinctSelectors: number;
}

/**
 * Untimed instrumentation walk: counts how many selector compositions and
 * string allocations tree2 performs for a shape — the leading indicator to
 * compare against the legacy `withComponents`/`cloneForPlacement`/`inherit`
 * counts. Kept OUT of the timed paths so it never taxes the fast path.
 */
export function composeStats(root: Root): ComposeStats {
  const stats: ComposeStats = { composeOps: 0, selectorAllocs: 0, distinctSelectors: 0 };
  const seen = new Set<string>();
  const walk = (rule: RuleNode, parent: string[] | null): void => {
    let composed: string[];
    if (parent === null) {
      composed = ownStrings(rule.selector);
    } else {
      composed = [];
      const token = parentToken(parent);
      if (parent.length > 1) stats.selectorAllocs++; // the :is(...) wrap
      for (const c of rule.selector.selectors) {
        stats.composeOps++;
        stats.selectorAllocs++;
        const s = composeOne(token, c);
        composed.push(s);
        seen.add(s);
      }
    }
    for (const child of rule.body) {
      if (child.kind === Kind.Rule) walk(child, composed);
    }
  };
  for (const child of root.children) {
    if (child.kind === Kind.Rule) walk(child, null);
  }
  stats.distinctSelectors = seen.size;
  return stats;
}
