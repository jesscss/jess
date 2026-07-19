/** Closed direct AST-v2 Parseman grammar pilot. */
import { choice, literal, many, node, optional, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import type { AtRuleBlock, AtRuleStatement, Comment, Declaration, Root, Rule, SelectorList, Statement, ValueNode } from '@jesscss/core/ast';

type DirectKeyword = Extract<ValueNode, { readonly type: 'Keyword' }>;
type DirectQuoted = Extract<ValueNode, { readonly type: 'Quoted' }>;
type DirectCssRules = {
  DirectCssDocument: Combinator<Root>;
  DirectCssComment: Combinator<Comment>;
  DirectCssSelector: Combinator<SelectorList>;
  DirectCssProperty: Combinator<string>;
  DirectCssKeyword: Combinator<DirectKeyword>;
  DirectCssDeclaration: Combinator<Declaration>;
  DirectCssCharset: Combinator<AtRuleStatement>;
  DirectCssRuleset: Combinator<Rule>;
  DirectCssMedia: Combinator<AtRuleBlock>;
  whitespace: Combinator<unknown>;
};

function tokenText(children: readonly unknown[], index: number): string {
  const child = children[index];
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('Direct CSS grammar lost a required token');
}

function isDirectKeyword(value: unknown): value is DirectKeyword {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Keyword'
    && 'src' in value
    && typeof value.src === 'string';
}

function isDirectQuoted(value: unknown): value is DirectQuoted {
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
    && isDirectKeyword(value.value)
    && 'merge' in value
    && value.merge === null
    && 'important' in value
    && value.important === false;
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
    && isDirectQuoted(value.prelude);
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
    && isDirectKeyword(value.prelude)
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
      throw new Error('DirectCssRuleset has an unexpected body child');
    }
    statements.push(child);
  }
  return statements;
}

function documentStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isDocumentStatement(child)) {
      throw new Error('DirectCssDocument has an unexpected child');
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
      throw new Error('DirectCssMedia has an unexpected body child');
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
const charsetEncoding = regex(/[A-Za-z0-9._-]+/);

export const directCssAstGrammar = rules<DirectCssRules>({ trivia: whitespace }, (g) => {
  const DirectCssComment = node('DirectCssComment', blockComment, children => ({
    type: 'Comment' as const,
    text: tokenText(children, 0)
  }));
  const DirectCssSelector = node('DirectCssSelector', simpleSelector, (children) => {
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
  const DirectCssProperty = node('DirectCssProperty', propertyName, children => tokenText(children, 0));
  const DirectCssKeyword = node('DirectCssKeyword', keywordValue, (children) => {
    const value: DirectKeyword = { type: 'Keyword', src: tokenText(children, 0) };
    return value;
  });
  const DirectCssDeclaration = node(
    'DirectCssDeclaration',
    sequence(g.DirectCssProperty, literal(':'), g.DirectCssKeyword, optional(literal(';'))),
    (children): Declaration => {
      const value = children[2];
      if (typeof children[0] !== 'string' || !isDirectKeyword(value)) {
        throw new Error('DirectCssDeclaration requires structured property and keyword children');
      }
      return { type: 'Declaration', name: children[0], value, merge: null, important: false };
    }
  );
  const DirectCssCharset = node(
    'DirectCssCharset',
    sequence(literal('@charset'), literal('"'), charsetEncoding, literal('"'), literal(';')),
    (children): AtRuleStatement => {
      const value = tokenText(children, 2);
      const prelude: DirectQuoted = { type: 'Quoted', src: `"${value}"`, value, quote: '"', escaped: false };
      return { type: 'AtRuleStatement', name: '@charset', prelude };
    }
  );
  const DirectCssRuleset = node(
    'DirectCssRuleset',
    sequence(g.DirectCssSelector, literal('{'), many(choice(g.DirectCssComment, g.DirectCssDeclaration)), literal('}')),
    (children) => {
      const selector = children[0];
      if (!isSelectorList(selector)) {
        throw new Error('DirectCssRuleset requires a selector');
      }
      return {
        type: 'Rule' as const,
        selector,
        body: rulesetStatements(children)
      };
    }
  );
  const DirectCssMedia = node(
    'DirectCssMedia',
    sequence(literal('@media'), g.DirectCssKeyword, literal('{'), many(choice(g.DirectCssComment, g.DirectCssRuleset)), literal('}')),
    (children): AtRuleBlock => {
      const prelude = children[1];
      if (!isDirectKeyword(prelude)) {
        throw new Error('DirectCssMedia requires a keyword prelude');
      }
      return { type: 'AtRuleBlock', name: '@media', prelude, body: mediaStatements(children) };
    }
  );
  const DirectCssDocument = node(
    'DirectCssDocument',
    many(choice(g.DirectCssComment, g.DirectCssCharset, g.DirectCssMedia, g.DirectCssRuleset)),
    children => ({ type: 'Root' as const, children: documentStatements(children) }),
    { trailingTrivia: true }
  );
  return {
    DirectCssDocument,
    DirectCssComment,
    DirectCssSelector,
    DirectCssProperty,
    DirectCssKeyword,
    DirectCssDeclaration,
    DirectCssCharset,
    DirectCssRuleset,
    DirectCssMedia,
    whitespace
  };
});
