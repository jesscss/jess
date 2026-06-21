import {
  atrule,
  atrulestatement,
  decl,
  ruleset,
  stylesheet,
  type Node,
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
      return ruleset({
        selector: text(source, node.headerStart, node.headerEnd),
        rules: childrenToAst(node.children, source)
      });

    case 'at-rule':
      return atrule({
        name: atRuleName(source, node),
        prelude: atRulePrelude(source, node),
        rules: childrenToAst(node.children, source)
      });

    case 'at-rule-statement':
    case 'import':
      return atrulestatement({
        name: text(source, node.nameStart, node.nameEnd),
        prelude: text(source, node.valueStart, node.valueEnd)
      });

    case 'declaration':
      return decl({
        name: text(source, node.nameStart, node.nameEnd),
        value: text(source, node.valueStart, node.valueEnd)
      });

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
