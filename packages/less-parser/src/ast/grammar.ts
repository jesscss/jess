/** Private AST grammar development slice for canonical Less facts. */
import { choice, literal, many, node, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import { comment, complex, compoundOf, decl, importAtRule, keyword, quoted, root, rule, selist, simple, varDecl, varRef } from '@jesscss/core/ast';
import type { Comment, Complex, Compound, Declaration, ImportAtRule, Quoted, Root, Rule, SelectorList, Statement, ValueNode, VarDeclaration, VarRef } from '@jesscss/core/ast';

type Token = { readonly value: string };

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Direct Less AST grammar produced a non-token child.');
  }
  return value;
}

function isQuoted(value: unknown): value is Quoted {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Quoted'
    && 'src' in value
    && typeof value.src === 'string'
    && 'value' in value
    && typeof value.value === 'string'
    && 'quote' in value
    && typeof value.quote === 'string'
    && 'escaped' in value
    && typeof value.escaped === 'boolean';
}

function requireQuoted(value: unknown): Quoted {
  if (!isQuoted(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-quoted target.');
  }
  return value;
}

function isImportAtRule(value: unknown): value is ImportAtRule {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'ImportAtRule'
    && 'name' in value
    && typeof value.name === 'string'
    && 'target' in value
    && isQuoted(value.target)
    && 'options' in value
    && 'alias' in value
    && 'tail' in value;
}

function isVarDeclaration(value: unknown): value is VarDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VarDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isValueNode(value.value);
}

function isVarRef(value: unknown): value is VarRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VarRef'
    && 'name' in value
    && typeof value.name === 'string';
}

function isValueNode(value: unknown): value is ValueNode {
  return isQuoted(value)
    || isVarRef(value)
    || (typeof value === 'object'
      && value !== null
      && 'type' in value
      && value.type === 'Keyword'
      && 'src' in value
      && typeof value.src === 'string');
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-value child.');
  }
  return value;
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && 'value' in value
    && isValueNode(value.value)
    && 'merge' in value
    && value.merge === null
    && 'important' in value
    && value.important === false;
}

function isComment(value: unknown): value is Comment {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Comment'
    && 'text' in value
    && typeof value.text === 'string';
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SelectorList'
    && 'selectors' in value
    && Array.isArray(value.selectors);
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-selector child.');
  }
  return value;
}

function isComplex(value: unknown): value is Complex {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Complex'
    && 'head' in value
    && 'tail' in value
    && Array.isArray(value.tail);
}

function requireComplex(value: unknown): Complex {
  if (!isComplex(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-complex selector child.');
  }
  return value;
}

function requireComplexes(children: readonly unknown[]): Complex[] {
  const selectors: Complex[] = [];
  for (const child of children) {
    selectors.push(requireComplex(child));
  }
  return selectors;
}

function isCompound(value: unknown): value is Compound {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Compound'
    && 'simples' in value
    && Array.isArray(value.simples);
}

function requireCompound(value: unknown): Compound {
  if (!isCompound(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-compound selector child.');
  }
  return value;
}

function isRule(value: unknown): value is Rule {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Rule'
    && 'selector' in value
    && isSelectorList(value.selector)
    && 'body' in value
    && Array.isArray(value.body);
}

function requireRulesetBody(children: readonly unknown[]): (VarDeclaration | Declaration | Comment)[] {
  const body: (VarDeclaration | Declaration | Comment)[] = [];
  for (const child of children) {
    if (!isVarDeclaration(child) && !isDeclaration(child) && !isComment(child)) {
      throw new TypeError('Direct Less AST grammar produced a non-ruleset-body child.');
    }
    body.push(child);
  }
  return body;
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isImportAtRule(child) && !isVarDeclaration(child) && !isDeclaration(child) && !isRule(child)) {
      throw new TypeError('Direct Less AST grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
}

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const importKeyword = regex(/@(?:-import|-export|import)(?![-\w])/i);
const variableName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const propertyName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const keywordValue = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
const doubleQuotedText = regex(/[^"\\]*/);
const singleQuotedText = regex(/[^'\\]*/);

export const lessAstGrammar = rules({ trivia: whitespace }, (g: any) => {
  const DirectLessQuoted = node<Quoted>(
    'DirectLessQuoted',
    choice(
      sequence(literal('"'), doubleQuotedText, literal('"')),
      sequence(literal('\''), singleQuotedText, literal('\''))
    ),
    (children) => {
      // The enclosing alternatives both fix these three grammar child slots.
      const open = requireToken(children[0]);
      const content = requireToken(children[1]);
      const quote = open.value;
      const value = content.value;
      return quoted(`${quote}${value}${quote}`, value, quote, false);
    }
  );
  const DirectLessImport = node<ImportAtRule>(
    'DirectLessImport',
    sequence(importKeyword, g.DirectLessQuoted, literal(';')),
    (children) => {
      // The direct quoted reduction above is the fixed second child here.
      const keyword = requireToken(children[0]);
      const target = requireQuoted(children[1]);
      return importAtRule(keyword.value, target);
    }
  );
  const DirectLessVarDeclaration = node<VarDeclaration>(
    'DirectLessVarDeclaration',
    sequence(literal('@'), variableName, literal(':'), g.DirectLessValue, literal(';')),
    (children) => {
      // The sigil and name are distinct grammar children, so AST `name` is not
      // recovered from authored text or sliced from a source span.
      const name = requireToken(children[1]);
      return varDecl(name.value, requireValueNode(children[3]));
    }
  );
  const DirectLessVarReference = node<VarRef>(
    'DirectLessVarReference',
    sequence(literal('@'), variableName),
    children => varRef(requireToken(children[1]).value)
  );
  const DirectLessKeyword = node<ValueNode>(
    'DirectLessKeyword',
    keywordValue,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectLessValue = node<ValueNode>(
    'DirectLessValue',
    choice(g.DirectLessQuoted, g.DirectLessVarReference, g.DirectLessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectLessDeclaration = node<Declaration>(
    'DirectLessDeclaration',
    sequence(propertyName, literal(':'), g.DirectLessValue, literal(';')),
    (children) => {
      // Property, delimiter, and value are independently recognized grammar
      // children; AST construction does not split or reclassify authored text.
      const name = requireToken(children[0]);
      return decl(name.value, requireValueNode(children[2]));
    }
  );
  const DirectLessComment = node<Comment>(
    'DirectLessComment',
    blockComment,
    children => comment(requireToken(children[0]).value)
  );
  const DirectLessCompound = node<Compound>(
    'DirectLessCompound',
    simpleSelector,
    (children) => {
      const text = requireToken(children[0]).value;
      return compoundOf([simple(text)]);
    }
  );
  const DirectLessChildComplex = node<Complex>(
    'DirectLessChildComplex',
    sequence(g.DirectLessCompound, literal('>'), g.DirectLessCompound),
    children => complex([
      { compound: requireCompound(children[0]) },
      { comb: '>', compound: requireCompound(children[2]) }
    ])
  );
  const DirectLessSimpleComplex = node<Complex>(
    'DirectLessSimpleComplex',
    g.DirectLessCompound,
    children => complex([{ compound: requireCompound(children[0]) }])
  );
  const DirectLessComplex = node<Complex>(
    'DirectLessComplex',
    choice(g.DirectLessChildComplex, g.DirectLessSimpleComplex),
    children => requireComplex(children[0])
  );
  const DirectLessSelectorTail = node<Complex>(
    'DirectLessSelectorTail',
    sequence(literal(','), g.DirectLessComplex),
    children => requireComplex(children[1])
  );
  const DirectLessSelector = node<SelectorList>(
    'DirectLessSelector',
    sequence(g.DirectLessComplex, many(g.DirectLessSelectorTail)),
    children => selist(...requireComplexes(children))
  );
  const DirectLessRuleset = node<Rule>(
    'DirectLessRuleset',
    sequence(g.DirectLessSelector, literal('{'), many(choice(g.DirectLessVarDeclaration, g.DirectLessDeclaration, g.DirectLessComment)), literal('}')),
    children => rule(
      requireSelectorList(children[0]),
      // The fixed sequence places only direct declaration/comment facts between
      // the braces. This validates that fact list; it never reparses body text.
      requireRulesetBody(children.slice(2, -1))
    )
  );
  const LessAstDocument = node<Root>(
    'LessAstDocument',
    many(choice(g.DirectLessImport, g.DirectLessVarDeclaration, g.DirectLessRuleset, g.DirectLessDeclaration)),
    children => root(requireStatements(children))
  );

  return {
    LessAstDocument,
    DirectLessImport,
    DirectLessVarDeclaration,
    DirectLessVarReference,
    DirectLessKeyword,
    DirectLessValue,
    DirectLessDeclaration,
    DirectLessComment,
    DirectLessCompound,
    DirectLessChildComplex,
    DirectLessSimpleComplex,
    DirectLessComplex,
    DirectLessSelectorTail,
    DirectLessSelector,
    DirectLessRuleset,
    DirectLessQuoted,
    whitespace
  };
});
