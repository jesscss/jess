/**
 * Clean-room tree2 byte-faithful serializer.
 *
 * Reproduces the exact output bytes the legacy renderer emits for the covered
 * shapes, designed fresh (it does NOT re-implement `writeSyntax`). Two paths:
 *
 *  - `serialize(root)` — the FAST path. No source-position tracking, no
 *    per-node bookkeeping, no position allocations. This is a primary result;
 *    it must be genuinely fast.
 *  - `serialize(root, { trackPositions: true })` — the OPTIONAL sourcemap
 *    feature. Additionally emits a node -> output-offset map. Its cost is
 *    reported separately from the fast path.
 *
 * Trivia/comment placement is structural (a `Comment` body child), so the
 * fast path is byte-identical WITHOUT any position tracking.
 */

import { Kind, Tree2Node } from './node.js';
import type { Root, Statement, ValueNode } from './nodes.js';

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

/* ----------------------------------------------------------- value bytes */

function valueText(node: ValueNode): string {
  switch (node.kind) {
    case Kind.Word:
      return node.text;
    case Kind.Dimension:
      return `${node.value}${node.unit}`;
    case Kind.SpacedValue: {
      // Join parts with a single space, matching the legacy spaced-sequence.
      const parts = node.parts;
      let out = parts.length > 0 ? valueText(parts[0]!) : '';
      for (let i = 1; i < parts.length; i++) {
        out += ' ' + valueText(parts[i]!);
      }
      return out;
    }
  }
}

/* -------------------------------------------------------------- fast path */

export function serialize(root: Root, options?: SerializeOptions): SerializeResult {
  if (options?.trackPositions) {
    return serializeTracked(root);
  }
  const chunks: string[] = [];
  for (const child of root.children) {
    emitFast(child, '', chunks);
  }
  return { css: chunks.join('') };
}

function emitFast(node: Statement, indent: string, out: string[]): void {
  switch (node.kind) {
    case Kind.Declaration:
      out.push(indent, node.name, ': ', valueText(node.value), ';\n');
      return;
    case Kind.Comment:
      out.push(indent, node.text, '\n');
      return;
    case Kind.Rule: {
      out.push(indent, node.selector.text, ' {\n');
      const childIndent = indent + INDENT;
      for (const child of node.body) {
        emitFast(child, childIndent, out);
      }
      out.push(indent, '}\n');
      return;
    }
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

function record(w: Writer, node: Tree2Node, start: number): void {
  w.positions.push({ node, kind: node.kind, start, end: w.off });
}

function serializeTracked(root: Root): SerializeResult {
  const w: Writer = { chunks: [], off: 0, positions: [] };
  const start = w.off;
  for (const child of root.children) {
    emitTracked(child, '', w);
  }
  record(w, root, start);
  return { css: w.chunks.join(''), positions: w.positions };
}

function emitTracked(node: Statement, indent: string, w: Writer): void {
  const start = w.off;
  switch (node.kind) {
    case Kind.Declaration: {
      put(w, indent);
      const valueStart = w.off;
      put(w, node.name);
      put(w, ': ');
      put(w, valueText(node.value));
      record(w, node.value, valueStart);
      put(w, ';\n');
      break;
    }
    case Kind.Comment:
      put(w, indent);
      put(w, node.text);
      put(w, '\n');
      break;
    case Kind.Rule: {
      put(w, indent);
      const selStart = w.off;
      put(w, node.selector.text);
      record(w, node.selector, selStart);
      put(w, ' {\n');
      const childIndent = indent + INDENT;
      for (const child of node.body) {
        emitTracked(child, childIndent, w);
      }
      put(w, indent);
      put(w, '}\n');
      break;
    }
  }
  record(w, node, start);
}
