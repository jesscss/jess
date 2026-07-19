/**
 * Private canonical-AST grammar development seam.
 *
 * This is deliberately not a parser API. It is the construction family that
 * will replace the deleted legacy CSS parser: Parseman reductions call the
 * core AST constructors directly, while the public CSS grammar continues to
 * produce the independent CST.
 */
import { balanced, choice, expect, literal, many, noTrivia, node, oneOrMore, optional, regex, rules, scanTo, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import {
  any,
  atRuleBlock,
  atRuleStatement,
  color,
  comment,
  complex,
  compoundOf,
  decl,
  dimension,
  funcCall,
  keyword,
  list,
  root,
  rule,
  selist,
  simple,
  spaced,
  url,
  quoted
} from '@jesscss/core/ast';
import type {
  AtRuleBlock,
  AtRuleStatement,
  Color,
  Comment,
  Complex,
  Compound,
  Declaration,
  Dimension,
  FunctionCall,
  Keyword,
  Quoted,
  Root,
  Rule,
  SelectorList,
  Simple,
  Statement,
  ValueNode
} from '@jesscss/core/ast';

type CssAstRules = {
  CssAstDocument: Combinator<Root>;
  CssAstComment: Combinator<Comment>;
  CssAstSelector: Combinator<SelectorList>;
  CssAstComplex: Combinator<Complex>;
  CssAstCompound: Combinator<Compound>;
  CssAstSimple: Combinator<Simple>;
  CssAstProperty: Combinator<string>;
  CssAstCustomProperty: Combinator<string>;
  CssAstCustomValue: Combinator<ValueNode>;
  CssAstKeyword: Combinator<Keyword>;
  CssAstColor: Combinator<Color>;
  CssAstDimension: Combinator<Dimension>;
  CssAstQuoted: Combinator<Quoted>;
  CssAstUrl: Combinator<ValueNode>;
  CssAstCall: Combinator<FunctionCall>;
  CssAstValueTerm: Combinator<ValueNode>;
  CssAstValue: Combinator<ValueNode>;
  CssAstImportant: Combinator<boolean>;
  CssAstDeclaration: Combinator<Declaration>;
  CssAstCharset: Combinator<AtRuleStatement>;
  CssAstAtRuleStatement: Combinator<AtRuleStatement>;
  CssAstLayerBlock: Combinator<AtRuleBlock>;
  CssAstKeyframeSelector: Combinator<Simple>;
  CssAstKeyframeBlock: Combinator<Rule>;
  CssAstKeyframes: Combinator<AtRuleBlock>;
  CssAstRuleset: Combinator<Rule>;
  CssAstMedia: Combinator<AtRuleBlock>;
  whitespace: Combinator<unknown>;
};

function tokenText(child: unknown): string {
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('CSS AST grammar lost a required token');
}

function isNodeType<T extends string>(value: unknown, type: T): value is { readonly type: T } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === type;
}

function isSimple(value: unknown): value is Simple {
  return isNodeType(value, 'Simple');
}

function isCompound(value: unknown): value is Compound {
  return isNodeType(value, 'Compound');
}

function isComplex(value: unknown): value is Complex {
  return isNodeType(value, 'Complex');
}

function isSelectorList(value: unknown): value is SelectorList {
  return isNodeType(value, 'SelectorList');
}

function isComment(value: unknown): value is Comment {
  return isNodeType(value, 'Comment');
}

function isDeclaration(value: unknown): value is Declaration {
  return isNodeType(value, 'Declaration');
}

function isRule(value: unknown): value is Rule {
  return isNodeType(value, 'Rule');
}

function isValue(value: unknown): value is ValueNode {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'Keyword' || value.type === 'Color' || value.type === 'Dimension'
      || value.type === 'Quoted' || value.type === 'Url' || value.type === 'FunctionCall'
      || value.type === 'SpacedValue' || value.type === 'List' || value.type === 'Any');
}

function isRulesetStatement(value: unknown): value is Comment | Declaration | Rule {
  return isComment(value) || isDeclaration(value) || isRule(value);
}

function isDocumentStatement(value: unknown): value is Statement {
  return isComment(value) || isRule(value) || isNodeType(value, 'AtRuleStatement') || isNodeType(value, 'AtRuleBlock');
}

function selectorComplexes(children: readonly unknown[]): Complex[] {
  const selectors = children.filter(isComplex);
  if (selectors.length === 0) {
    throw new Error('CssAstSelector requires a complex selector');
  }
  return selectors;
}

function complexSegments(children: readonly unknown[]): Array<{ comb?: ' ' | '>' | '+' | '~' | '|' | '||'; compound: Compound }> {
  const segments: Array<{ comb?: ' ' | '>' | '+' | '~' | '|' | '||'; compound: Compound }> = [];
  let comb: ' ' | '>' | '+' | '~' | '|' | '||' = ' ';
  for (const child of children) {
    if (isCompound(child)) {
      segments.push(segments.length === 0 ? { compound: child } : { comb, compound: child });
      comb = ' ';
      continue;
    }
    const token = tokenText(child);
    if (token !== '>' && token !== '+' && token !== '~' && token !== '|' && token !== '||') {
      throw new Error('CssAstComplex has an invalid combinator');
    }
    comb = token;
  }
  if (segments.length === 0) {
    throw new Error('CssAstComplex requires a compound selector');
  }
  return segments;
}

function valueChildren(children: readonly unknown[]): ValueNode[] {
  const values = children.filter(isValue);
  if (values.length === 0) {
    throw new Error('CSS AST value grammar lost its value child');
  }
  return values;
}

function rulesetStatements(children: readonly unknown[]): Array<Comment | Declaration | Rule> {
  return children.filter(isRulesetStatement);
}

function documentStatements(children: readonly unknown[]): Statement[] {
  const statements = children.filter(isDocumentStatement);
  if (statements.length !== children.length) {
    throw new Error('CssAstDocument has an unexpected child');
  }
  return statements;
}

function mediaStatements(children: readonly unknown[]): Array<Comment | Rule> {
  return children.filter((value): value is Comment | Rule => isComment(value) || isRule(value));
}

function keyframeSelectorList(children: readonly unknown[]): SelectorList {
  const selectors = children.filter(isSimple).map(selector => complex([{ compound: compoundOf([selector]) }]));
  if (selectors.length === 0) {
    throw new Error('CssAstKeyframeBlock requires a keyframe selector');
  }
  return selist(...selectors);
}

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
const propertyName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const customPropertyName = regex(/--(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const keywordValue = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const hexColor = regex(/#[0-9a-fA-F]{3,8}\b/);
const dimensionNumber = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/);
const dimensionUnit = regex(/[A-Za-z%]+/);
const charsetEncoding = regex(/[A-Za-z0-9._-]+/);
// `@import` has a plugin-owned typed fact and must not be silently lowered to
// a generic statement while that grammar is built. `@charset` has its own
// grammar because its quoted encoding has narrower syntax than a CSS value.
const genericAtRuleName = regex(/@(?!(?:charset|import)(?=[^-_a-zA-Z0-9\u0080-\uffff]|$))-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const atLayer = regex(/@layer(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const layerName = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*(?:\.-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)*/);
const atKeyframes = regex(/@(?:-[a-z]+-)?keyframes(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const keyframePercent = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%/);
const keyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
const doubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const singleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const customEscape = regex(/\\[^\n\r\f]/);
const customDoubleQuoted = sequence(literal('"'), doubleQuotedText, literal('"'));
const customSingleQuoted = sequence(literal('\''), singleQuotedText, literal('\''));
// A custom property is a CSS `<declaration-value>`: its opaque bytes must be
// captured as one value while its balanced groups, quoted strings, and comments
// cannot terminate the declaration. This is a Parseman grammar combinator, not
// a secondary scanner or a post-parse source slice.
const customValue = scanTo(choice(literal(';'), literal('}')), {
  skip: [
    blockComment,
    customEscape,
    customDoubleQuoted,
    customSingleQuoted,
    balanced('(', ')', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    balanced('{', '}', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
  ]
});
const urlOpen = regex(/url\(/i);
const urlInner = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

export const cssAstGrammar = rules<CssAstRules>({ trivia: whitespace }, (g) => {
  const CssAstComment = node('CssAstComment', blockComment, children => comment(tokenText(children[0])));
  const CssAstSimple = node('CssAstSimple', simpleSelector, children => simple(tokenText(children[0])));
  const CssAstCompound = node('CssAstCompound', noTrivia(oneOrMore(g.CssAstSimple)), (children) => {
    const simples = children.filter(isSimple);
    if (simples.length === 0) {
      throw new Error('CssAstCompound requires a simple selector');
    }
    return compoundOf(simples);
  });
  const CssAstComplex = node(
    'CssAstComplex',
    sequence(g.CssAstCompound, many(sequence(optional(combinator), g.CssAstCompound))),
    children => complex(complexSegments(children))
  );
  const CssAstSelector = node(
    'CssAstSelector',
    sequence(g.CssAstComplex, many(sequence(literal(','), g.CssAstComplex))),
    children => selist(...selectorComplexes(children))
  );
  const CssAstProperty = node('CssAstProperty', propertyName, children => tokenText(children[0]));
  const CssAstCustomProperty = node('CssAstCustomProperty', customPropertyName, children => tokenText(children[0]));
  const CssAstCustomValue = node(
    'CssAstCustomValue',
    customValue,
    children => any(children.length === 0 ? '' : tokenText(children[0]))
  );
  const CssAstKeyword = node('CssAstKeyword', keywordValue, children => keyword(tokenText(children[0])));
  const CssAstColor = node('CssAstColor', hexColor, children => color(tokenText(children[0])));
  const CssAstDimension = node(
    'CssAstDimension',
    sequence(dimensionNumber, optional(dimensionUnit)),
    (children) => {
      const numberText = tokenText(children[0]);
      const unit = children.length > 1 ? tokenText(children[1]) : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const CssAstQuoted = node(
    'CssAstQuoted',
    choice(
      noTrivia(sequence(literal('"'), doubleQuotedText, literal('"'))),
      noTrivia(sequence(literal('\''), singleQuotedText, literal('\'')))
    ),
    (children) => {
      const quote = tokenText(children[0]);
      const value = tokenText(children[1]);
      return quoted(`${quote}${value}${quote}`, value, quote, false);
    }
  );
  const CssAstUrl = node(
    'CssAstUrl',
    sequence(urlOpen, optional(choice(g.CssAstQuoted, urlInner)), expect(literal(')'), ')')),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(''));
    }
  );
  const CssAstCall = node(
    'CssAstCall',
    sequence(g.CssAstProperty, literal('('), optional(sequence(g.CssAstValueTerm, many(sequence(literal(','), g.CssAstValueTerm)))), literal(')')),
    (children) => {
      const name = tokenText(children[0]);
      return funcCall(name, children.slice(1).filter(isValue));
    }
  );
  const CssAstValueAtom = node(
    'CssAstValueAtom',
    choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstCall, g.CssAstQuoted, g.CssAstKeyword),
    children => valueChildren(children)[0]!
  );
  const CssAstValueTerm = node('CssAstValueTerm', oneOrMore(CssAstValueAtom), (children) => {
    const values = valueChildren(children);
    return values.length === 1 ? values[0]! : spaced(values);
  });
  const CssAstValue = node(
    'CssAstValue',
    sequence(g.CssAstValueTerm, many(sequence(literal(','), g.CssAstValueTerm))),
    (children) => {
      const terms = valueChildren(children);
      return terms.length === 1 ? terms[0]! : list(terms, Array(terms.length - 1).fill(','));
    }
  );
  const CssAstImportant = node('CssAstImportant', literal('!important'), () => true);
  const CssAstDeclaration = node(
    'CssAstDeclaration',
    choice(
      sequence(g.CssAstCustomProperty, literal(':'), g.CssAstCustomValue, optional(literal(';'))),
      sequence(g.CssAstProperty, literal(':'), g.CssAstValue, optional(g.CssAstImportant), optional(literal(';')))
    ),
    (children) => {
      const name = tokenText(children[0]);
      if (name.startsWith('--')) {
        const value = children.find((child): child is ValueNode => isNodeType(child, 'Any'));
        if (value === undefined) {
          throw new Error('CssAstDeclaration requires a captured custom-property value');
        }
        return decl(name, value);
      }
      const value = children.find(isValue);
      if (value === undefined) {
        throw new Error('CssAstDeclaration requires a structured value');
      }
      return decl(name, value, null, children.includes(true));
    }
  );
  const CssAstCharset = node(
    'CssAstCharset',
    sequence(literal('@charset'), literal('"'), charsetEncoding, literal('"'), literal(';')),
    children => atRuleStatement('@charset', quoted(tokenText(children[2]), tokenText(children[2]), '"', false))
  );
  const CssAstAtRuleStatement = node(
    'CssAstAtRuleStatement',
    sequence(genericAtRuleName, optional(g.CssAstValue), literal(';')),
    (children) => {
      const name = tokenText(children[0]);
      return atRuleStatement(name, children.find(isValue) ?? null);
    }
  );
  const CssAstLayerName = node('CssAstLayerName', layerName, children => keyword(tokenText(children[0])));
  const CssAstLayerBlock = node(
    'CssAstLayerBlock',
    sequence(atLayer, optional(CssAstLayerName), literal('{'), many(choice(g.CssAstComment, g.CssAstRuleset)), literal('}')),
    children => atRuleBlock('@layer', children.find(isValue) ?? null, mediaStatements(children))
  );
  const CssAstKeyframeSelector = node(
    'CssAstKeyframeSelector',
    choice(keyframeEndpoint, keyframePercent),
    children => simple(tokenText(children[0]))
  );
  const CssAstKeyframeBlock = node(
    'CssAstKeyframeBlock',
    sequence(
      g.CssAstKeyframeSelector,
      many(sequence(literal(','), g.CssAstKeyframeSelector)),
      literal('{'),
      many(choice(g.CssAstComment, g.CssAstDeclaration)),
      literal('}')
    ),
    children => rule(keyframeSelectorList(children), children.filter((value): value is Comment | Declaration => isComment(value) || isDeclaration(value)))
  );
  const CssAstKeyframes = node(
    'CssAstKeyframes',
    sequence(atKeyframes, g.CssAstKeyword, literal('{'), many(choice(g.CssAstComment, g.CssAstKeyframeBlock)), literal('}')),
    (children) => {
      const prelude = children.find((value): value is Keyword => isNodeType(value, 'Keyword'));
      if (prelude === undefined) {
        throw new Error('CssAstKeyframes requires a name');
      }
      return atRuleBlock(tokenText(children[0]), prelude, mediaStatements(children));
    }
  );
  const CssAstRuleset = node(
    'CssAstRuleset',
    sequence(g.CssAstSelector, literal('{'), many(choice(g.CssAstComment, g.CssAstDeclaration, g.CssAstRuleset)), literal('}')),
    (children) => {
      const selector = children.find(isSelectorList);
      if (selector === undefined) {
        throw new Error('CssAstRuleset requires a selector');
      }
      return rule(selector, rulesetStatements(children));
    }
  );
  const CssAstMedia = node(
    'CssAstMedia',
    sequence(literal('@media'), g.CssAstValue, literal('{'), many(choice(g.CssAstComment, g.CssAstRuleset)), literal('}')),
    (children) => {
      const prelude = children.find(isValue);
      if (prelude === undefined) {
        throw new Error('CssAstMedia requires a structured prelude');
      }
      return atRuleBlock('@media', prelude, mediaStatements(children));
    }
  );
  const CssAstDocument = node(
    'CssAstDocument',
    many(choice(g.CssAstComment, g.CssAstCharset, g.CssAstMedia, g.CssAstLayerBlock, g.CssAstKeyframes, g.CssAstAtRuleStatement, g.CssAstRuleset)),
    children => root(documentStatements(children)),
    { trailingTrivia: true }
  );
  return {
    CssAstDocument,
    CssAstComment,
    CssAstSelector,
    CssAstComplex,
    CssAstCompound,
    CssAstSimple,
    CssAstProperty,
    CssAstCustomProperty,
    CssAstCustomValue,
    CssAstKeyword,
    CssAstColor,
    CssAstDimension,
    CssAstQuoted,
    CssAstUrl,
    CssAstCall,
    CssAstValueTerm,
    CssAstValue,
    CssAstImportant,
    CssAstDeclaration,
    CssAstCharset,
    CssAstAtRuleStatement,
    CssAstLayerBlock,
    CssAstKeyframeSelector,
    CssAstKeyframeBlock,
    CssAstKeyframes,
    CssAstRuleset,
    CssAstMedia,
    whitespace
  };
});
