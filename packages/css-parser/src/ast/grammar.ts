/** Private canonical-AST grammar development seam. */
import { choice, literal, many, node, optional, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import type { AtRuleBlock, AtRuleStatement, Comment, Declaration, Root, Rule, SelectorList, Statement, ValueNode } from '@jesscss/core/ast';

type CssAstKeyword = Extract<ValueNode, { readonly type: 'Keyword' }>;
type CssAstDimension = Extract<ValueNode, { readonly type: 'Dimension' }>;
type CssAstQuoted = Extract<ValueNode, { readonly type: 'Quoted' }>;
type CssAstRules = {
  CssAstDocument: Combinator<Root>;
  CssAstComment: Combinator<Comment>;
  CssAstSelector: Combinator<SelectorList>;
  CssAstProperty: Combinator<string>;
  CssAstKeyword: Combinator<CssAstKeyword>;
  CssAstDimension: Combinator<CssAstDimension>;
  CssAstDeclaration: Combinator<Declaration>;
  CssAstCharset: Combinator<AtRuleStatement>;
  CssAstRuleset: Combinator<Rule>;
  CssAstMedia: Combinator<AtRuleBlock>;
  whitespace: Combinator<unknown>;
};

function tokenText(children: readonly unknown[], index: number): string {
  const child = children[index];
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('CSS AST grammar lost a required token');
}

function isCssAstKeyword(value: unknown): value is CssAstKeyword {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Keyword'
    && 'src' in value
    && typeof value.src === 'string';
}

function isCssAstDimension(value: unknown): value is CssAstDimension {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Dimension'
    && 'number' in value
    && typeof value.number === 'number'
    && Number.isFinite(value.number)
    && 'unit' in value
    && typeof value.unit === 'string'
    && 'src' in value
    && typeof value.src === 'string';
}

function isCssAstQuoted(value: unknown): value is CssAstQuoted {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Quoted'
    && 'src' in value
    && typeof value.src === 'string'
    && 'value' in value
    && typeof value.value === 'string'
    && 'quote' in value
    && value.quote === '"'
    && 'escaped' in value
    && value.escaped === false;
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SelectorList'
    && 'selectors' in value
    && Array.isArray(value.selectors);
}

function isComment(value: unknown): value is Comment {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Comment'
    && 'text' in value
    && typeof value.text === 'string';
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isCssAstValue(value.value)
    && 'merge' in value
    && value.merge === null
    && 'important' in value
    && value.important === false;
}

function isCssAstValue(value: unknown): value is CssAstKeyword | CssAstDimension {
  return isCssAstKeyword(value) || isCssAstDimension(value);
}

function isRule(value: unknown): value is Rule {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Rule'
    && 'selector' in value
    && isSelectorList(value.selector)
    && 'body' in value
    && Array.isArray(value.body)
    && value.body.every(isRulesetStatement);
}

function isRulesetStatement(value: unknown): value is Comment | Declaration {
  return isComment(value) || isDeclaration(value);
}

function isCharsetStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'AtRuleStatement'
    && 'name' in value
    && value.name === '@charset'
    && 'prelude' in value
    && isCssAstQuoted(value.prelude);
}

function isMediaBodyStatement(value: unknown): value is Comment | Rule {
  return isComment(value) || isRule(value);
}

function isMediaBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'AtRuleBlock'
    && 'name' in value
    && value.name === '@media'
    && 'prelude' in value
    && isCssAstKeyword(value.prelude)
    && 'body' in value
    && Array.isArray(value.body)
    && value.body.every(isMediaBodyStatement);
}

function isDocumentStatement(value: unknown): value is Statement {
  return isComment(value) || isRule(value) || isCharsetStatement(value) || isMediaBlock(value);
}

function rulesetStatements(children: readonly unknown[]): (Comment | Declaration)[] {
  const statements: (Comment | Declaration)[] = [];
  for (let index = 2; index < children.length - 1; index += 1) {
    const child = children[index];
    if (!isRulesetStatement(child)) {
      throw new Error('CssAstRuleset has an unexpected body child');
    }
    statements.push(child);
  }
  return statements;
}

function documentStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isDocumentStatement(child)) {
      throw new Error('CssAstDocument has an unexpected child');
    }
    statements.push(child);
  }
  return statements;
}

function mediaStatements(children: readonly unknown[]): (Comment | Rule)[] {
  const statements: (Comment | Rule)[] = [];
  for (let index = 3; index < children.length - 1; index += 1) {
    const child = children[index];
    if (!isMediaBodyStatement(child)) {
      throw new Error('CssAstMedia has an unexpected body child');
    }
    statements.push(child);
  }
  return statements;
}

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
const propertyName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const keywordValue = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const dimensionNumber = regex(/-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/);
const dimensionUnit = regex(/[A-Za-z%]+/);
const charsetEncoding = regex(/[A-Za-z0-9._-]+/);

export const cssAstGrammar = rules<CssAstRules>({ trivia: whitespace }, (g) => {
  const CssAstComment = node('CssAstComment', blockComment, children => ({
    type: 'Comment' as const,
    text: tokenText(children, 0)
  }));
  const CssAstSelector = node('CssAstSelector', simpleSelector, (children) => {
    const text = tokenText(children, 0);
    return {
      type: 'SelectorList' as const,
      selectors: [{
        type: 'Complex' as const,
        head: { type: 'Compound' as const, simples: [{ type: 'Simple' as const, text, interp: null }] },
        tail: []
      }]
    };
  });
  const CssAstProperty = node('CssAstProperty', propertyName, children => tokenText(children, 0));
  const CssAstKeyword = node('CssAstKeyword', keywordValue, (children) => {
    const value: CssAstKeyword = { type: 'Keyword', src: tokenText(children, 0) };
    return value;
  });
  const CssAstDimension = node(
    'CssAstDimension',
    sequence(dimensionNumber, dimensionUnit),
    (children): CssAstDimension => {
      const srcNumber = tokenText(children, 0);
      const unit = tokenText(children, 1);
      return { type: 'Dimension', number: Number(srcNumber), unit, src: `${srcNumber}${unit}` };
    }
  );
  const CssAstDeclaration = node(
    'CssAstDeclaration',
    sequence(g.CssAstProperty, literal(':'), choice(g.CssAstDimension, g.CssAstKeyword), optional(literal(';'))),
    (children): Declaration => {
      const value = children[2];
      if (typeof children[0] !== 'string' || !isCssAstValue(value)) {
        throw new Error('CssAstDeclaration requires structured property and value children');
      }
      return { type: 'Declaration', name: children[0], value, merge: null, important: false };
    }
  );
  const CssAstCharset = node(
    'CssAstCharset',
    sequence(literal('@charset'), literal('"'), charsetEncoding, literal('"'), literal(';')),
    (children): AtRuleStatement => {
      const value = tokenText(children, 2);
      const prelude: CssAstQuoted = { type: 'Quoted', src: `"${value}"`, value, quote: '"', escaped: false };
      return { type: 'AtRuleStatement', name: '@charset', prelude };
    }
  );
  const CssAstRuleset = node(
    'CssAstRuleset',
    sequence(g.CssAstSelector, literal('{'), many(choice(g.CssAstComment, g.CssAstDeclaration)), literal('}')),
    (children) => {
      const selector = children[0];
      if (!isSelectorList(selector)) {
        throw new Error('CssAstRuleset requires a selector');
      }
      return {
        type: 'Rule' as const,
        selector,
        body: rulesetStatements(children)
      };
    }
  );
  const CssAstMedia = node(
    'CssAstMedia',
    sequence(literal('@media'), g.CssAstKeyword, literal('{'), many(choice(g.CssAstComment, g.CssAstRuleset)), literal('}')),
    (children): AtRuleBlock => {
      const prelude = children[1];
      if (!isCssAstKeyword(prelude)) {
        throw new Error('CssAstMedia requires a keyword prelude');
      }
      return { type: 'AtRuleBlock', name: '@media', prelude, body: mediaStatements(children) };
    }
  );
  const CssAstDocument = node(
    'CssAstDocument',
    many(choice(g.CssAstComment, g.CssAstCharset, g.CssAstMedia, g.CssAstRuleset)),
    children => ({ type: 'Root' as const, children: documentStatements(children) }),
    { trailingTrivia: true }
  );
  return {
    CssAstDocument,
    CssAstComment,
    CssAstSelector,
    CssAstProperty,
    CssAstKeyword,
    CssAstDimension,
    CssAstDeclaration,
    CssAstCharset,
    CssAstRuleset,
    CssAstMedia,
    whitespace
  };
});
