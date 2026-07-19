/** Private AST grammar development slice for canonical Less facts. */
import { choice, literal, many, node, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Comment, Complex, Compound, Declaration, ImportAtRule, Quoted, Root, Rule, SelectorList, Statement, VarDeclaration } from '@jesscss/core/ast';

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
    && isQuoted(value.value);
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && typeof value.value === 'object'
    && value.value !== null
    && 'type' in value.value
    && value.value.type === 'Keyword'
    && 'src' in value.value
    && typeof value.value.src === 'string'
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

function requireRulesetBody(children: readonly unknown[]): (Declaration | Comment)[] {
  const body: (Declaration | Comment)[] = [];
  for (const child of children) {
    if (!isDeclaration(child) && !isComment(child)) {
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
      return { type: 'Quoted', src: `${quote}${value}${quote}`, value, quote, escaped: false };
    }
  );
  const DirectLessImport = node<ImportAtRule>(
    'DirectLessImport',
    sequence(importKeyword, g.DirectLessQuoted, literal(';')),
    (children) => {
      // The direct quoted reduction above is the fixed second child here.
      const keyword = requireToken(children[0]);
      const target = requireQuoted(children[1]);
      return {
        type: 'ImportAtRule',
        name: keyword.value,
        options: null,
        target,
        alias: null,
        tail: null
      };
    }
  );
  const DirectLessVarDeclaration = node<VarDeclaration>(
    'DirectLessVarDeclaration',
    sequence(literal('@'), variableName, literal(':'), g.DirectLessQuoted, literal(';')),
    (children) => {
      // The sigil and name are distinct grammar children, so AST `name` is not
      // recovered from authored text or sliced from a source span.
      const name = requireToken(children[1]);
      const value = requireQuoted(children[3]);
      return { type: 'VarDeclaration', name: name.value, value };
    }
  );
  const DirectLessDeclaration = node<Declaration>(
    'DirectLessDeclaration',
    sequence(propertyName, literal(':'), keywordValue, literal(';')),
    (children) => {
      // Property, delimiter, and value are independently recognized grammar
      // children; AST construction does not split or reclassify authored text.
      const name = requireToken(children[0]);
      const value = requireToken(children[2]);
      return {
        type: 'Declaration',
        name: name.value,
        value: { type: 'Keyword', src: value.value },
        merge: null,
        important: false
      };
    }
  );
  const DirectLessComment = node<Comment>(
    'DirectLessComment',
    blockComment,
    children => ({ type: 'Comment', text: requireToken(children[0]).value })
  );
  const DirectLessCompound = node<Compound>(
    'DirectLessCompound',
    simpleSelector,
    (children) => {
      const text = requireToken(children[0]).value;
      return {
        type: 'Compound',
        simples: [{ type: 'Simple', text, interp: null }]
      };
    }
  );
  const DirectLessChildComplex = node<Complex>(
    'DirectLessChildComplex',
    sequence(g.DirectLessCompound, literal('>'), g.DirectLessCompound),
    children => ({
      type: 'Complex',
      head: requireCompound(children[0]),
      tail: [{ comb: '>', compound: requireCompound(children[2]) }]
    })
  );
  const DirectLessSimpleComplex = node<Complex>(
    'DirectLessSimpleComplex',
    g.DirectLessCompound,
    children => ({ type: 'Complex', head: requireCompound(children[0]), tail: [] })
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
    children => ({ type: 'SelectorList', selectors: requireComplexes(children) })
  );
  const DirectLessRuleset = node<Rule>(
    'DirectLessRuleset',
    sequence(g.DirectLessSelector, literal('{'), many(choice(g.DirectLessDeclaration, g.DirectLessComment)), literal('}')),
    children => ({
      type: 'Rule',
      selector: requireSelectorList(children[0]),
      // The fixed sequence places only direct declaration/comment facts between
      // the braces. This validates that fact list; it never reparses body text.
      body: requireRulesetBody(children.slice(2, -1))
    })
  );
  const LessAstDocument = node<Root>(
    'LessAstDocument',
    many(choice(g.DirectLessImport, g.DirectLessVarDeclaration, g.DirectLessRuleset, g.DirectLessDeclaration)),
    children => ({ type: 'Root', children: requireStatements(children) })
  );

  return {
    LessAstDocument,
    DirectLessImport,
    DirectLessVarDeclaration,
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
