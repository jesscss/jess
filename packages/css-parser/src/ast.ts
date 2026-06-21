import {
  atrule,
  atrulestatement,
  decl,
  Node,
  ruleset,
  stylesheet,
  type Stylesheet
} from '@jesscss/core';
import type {
  StructuralContainerNode,
  StructuralNode,
  StructuralStatementNode
} from '@jesscss/parser/structure/index';
import { renderParserDiagnostic } from '@jesscss/parser';
import { parseCssStructure } from './structural.js';

/**
 * Parses the cheap CSS structural subset into real core AST nodes.
 *
 * This is the compiler-facing proof path: it produces a `Stylesheet` and keeps
 * selector/name/value/prelude fields as strings until later code proves it needs
 * typed parsing.
 */
export function parseCssStylesheet(filePath: string, source: string): Stylesheet {
  const document = parseCssStructure(filePath, source);
  if (document.diagnostics.length > 0) {
    const diagnostic = renderParserDiagnostic(document.source, document.diagnostics[0]!);
    throw new SyntaxError(`${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`);
  }
  const root = stylesheet(childrenToAst(document.root.children, source));

  return root;
}

function childrenToAst(children: readonly StructuralNode[], source: string): Node[] {
  const out: Node[] = [];

  for (const child of children) {
    if (child.kind === 'error' || child.kind === 'raw-island') {
      continue;
    }
    out.push(nodeToAst(child, source));
  }

  return out;
}

function nodeToAst(node: StructuralContainerNode | StructuralStatementNode, source: string): Node {
  switch (node.kind) {
    case 'rule':
      return withFieldSpans(ruleset({
        selector: text(source, node.headerStart, node.headerEnd),
        rules: childrenToAst(node.children, source)
      }), [
        ['selector', node.headerStart, node.headerEnd]
      ]);

    case 'at-rule':
      return withFieldSpans(atrule({
        name: atRuleName(source, node),
        prelude: atRulePrelude(source, node),
        rules: childrenToAst(node.children, source)
      }), atRuleFieldSpans(source, node));

    case 'at-rule-statement':
    case 'import':
      return withFieldSpans(atrulestatement({
        name: text(source, node.nameStart, node.nameEnd),
        prelude: text(source, node.valueStart, node.valueEnd)
      }), [
        ['name', node.nameStart, node.nameEnd],
        ['prelude', node.valueStart, node.valueEnd]
      ]);

    case 'declaration':
      return withFieldSpans(decl({
        name: text(source, node.nameStart, node.nameEnd),
        value: text(source, node.valueStart, node.valueEnd)
      }), [
        ['name', node.nameStart, node.nameEnd],
        ['value', node.valueStart, node.valueEnd]
      ]);

    case 'block':
    case 'mixin-call':
    case 'mixin-definition':
    case 'variable-declaration':
      throw new SyntaxError(`CSS AST parsing does not support structural ${node.kind} nodes.`);

    case 'document':
      return stylesheet(childrenToAst(node.children, source));
  }
}

function text(source: string, start: number, end: number): string {
  return source.slice(start, end);
}

function atRuleName(source: string, node: StructuralContainerNode): string {
  const header = text(source, node.headerStart, node.headerEnd);
  const match = /^@[A-Za-z][\w-]*/u.exec(header);
  return match?.[0] ?? header;
}

function atRulePrelude(source: string, node: StructuralContainerNode): string {
  const name = atRuleName(source, node);
  const start = node.headerStart + name.length;
  return text(source, start, node.headerEnd).trim();
}

type FieldSpanInput = readonly [field: string, start: number, end: number];
type NodeConstructorWithChildKeys = {
  readonly childKeys?: readonly string[] | null;
};

function atRuleFieldSpans(source: string, node: StructuralContainerNode): FieldSpanInput[] {
  const name = atRuleName(source, node);
  const preludeStart = node.headerStart + name.length;
  return [
    ['name', node.headerStart, node.headerStart + name.length],
    ['prelude', trimStart(source, preludeStart, node.headerEnd), node.headerEnd]
  ];
}

function withFieldSpans<T extends Node>(node: T, fields: readonly FieldSpanInput[]): T {
  for (const [field, start, end] of fields) {
    setFieldSpan(node, field, start, end);
  }
  return node;
}

function setFieldSpan(node: Node, field: string, start: number, end: number): void {
  const childKeys = childKeysFor(node);
  if (!childKeys) {
    throw new TypeError(`${node.type} does not declare childKeys for field spans.`);
  }
  const index = childKeys.indexOf(field);
  if (index === -1) {
    throw new TypeError(`${node.type} does not declare a ${field} child field.`);
  }
  const spans = node.spans ??= emptyFieldSpans(childKeys.length);
  const offset = index * 3;
  spans[offset] = start;
  spans[offset + 1] = end;
  spans[offset + 2] = 0;
}

function childKeysFor(node: Node): readonly string[] | null | undefined {
  const constructor = node.constructor;
  if (!hasChildKeys(constructor)) {
    return undefined;
  }
  return constructor.childKeys;
}

function hasChildKeys(value: unknown): value is NodeConstructorWithChildKeys {
  return typeof value === 'function' && 'childKeys' in value;
}

function emptyFieldSpans(fieldCount: number): number[] {
  const spans = new Array<number>(fieldCount * 3);
  for (let i = 0; i < spans.length; i += 3) {
    spans[i] = -1;
    spans[i + 1] = -1;
    spans[i + 2] = 0;
  }
  return spans;
}

function trimStart(source: string, start: number, end: number): number {
  let offset = start;
  while (offset < end && isWhitespace(source.charCodeAt(offset))) {
    offset++;
  }
  return offset;
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}
