/**
 * Private canonical-AST grammar development seam.
 *
 * This is deliberately not a parser API. It is the construction family that
 * will replace the deleted legacy CSS parser: Parseman reductions call the
 * core AST constructors directly, while the public CSS grammar continues to
 * produce the independent CST.
 */
import { balanced, choice, composeLeaf, expect, literal, many, noTrivia, node, oneOrMore, optional, parser, regex, rules, scanTo, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
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
  importAtRule,
  keyword,
  list,
  operation,
  paren,
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
  ImportAtRule,
  Keyword,
  Paren,
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
  CssAstCalcCall: Combinator<FunctionCall>;
  CssAstCalcParen: Combinator<Paren>;
  CssAstCalcValue: Combinator<ValueNode>;
  CssAstMathProduct: Combinator<ValueNode>;
  CssAstMathSum: Combinator<ValueNode>;
  CssAstValueTerm: Combinator<ValueNode>;
  CssAstValue: Combinator<ValueNode>;
  CssAstImportant: Combinator<boolean>;
  CssAstDeclaration: Combinator<Declaration>;
  CssAstCharset: Combinator<AtRuleStatement>;
  CssAstImport: Combinator<ImportAtRule>;
  CssAstImportTailRaw: Combinator<ValueNode>;
  CssAstImportTailBody: Combinator<ValueNode>;
  CssAstImportTail: Combinator<ValueNode>;
  CssAstAtRuleStatement: Combinator<AtRuleStatement>;
  CssAstLayerBlock: Combinator<AtRuleBlock>;
  CssAstKeyframeSelector: Combinator<Simple>;
  CssAstKeyframeBlock: Combinator<Rule>;
  CssAstKeyframes: Combinator<AtRuleBlock>;
  CssAstRuleset: Combinator<Rule>;
  CssAstMedia: Combinator<AtRuleBlock>;
  CssAstSyntaxProperty: Combinator<string>;
  CssAstSyntaxKeyword: Combinator<string>;
  CssAstSyntaxDoubleQuotedText: Combinator<string>;
  CssAstSyntaxSingleQuotedText: Combinator<string>;
  CssAstSyntaxUrlOpen: Combinator<string>;
  CssAstSyntaxUrlInner: Combinator<string>;
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

function sourceText(child: unknown): string {
  if (typeof child === 'object' && child !== null && 'src' in child && typeof child.src === 'string') {
    return child.src;
  }
  return tokenText(child);
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
      || value.type === 'Paren' || value.type === 'Operation' || value.type === 'SpacedValue'
      || value.type === 'List' || value.type === 'Any');
}

function isImportTarget(value: unknown): value is Quoted | { readonly type: 'Url'; readonly value: ValueNode } {
  return isNodeType(value, 'Quoted') || isNodeType(value, 'Url');
}

function isRulesetStatement(value: unknown): value is Comment | Declaration | Rule {
  return isComment(value) || isDeclaration(value) || isRule(value);
}

function isDocumentStatement(value: unknown): value is Statement {
  return isComment(value)
    || isRule(value)
    || isNodeType(value, 'AtRuleStatement')
    || isNodeType(value, 'AtRuleBlock')
    || isNodeType(value, 'ImportAtRule');
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

function foldOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValue);
  if (first === undefined) {
    throw new Error('CSS AST math grammar requires an operand');
  }
  let result = first;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValue(right)) {
      throw new Error('CSS AST math grammar lost an operator operand');
    }
    result = operation(tokenText(operatorToken).trim(), result, right);
  }
  return result;
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
const customPropertyName = regex(/--(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const hexColor = regex(/#[0-9a-fA-F]{3,8}\b/);
const dimensionNumber = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/);
const dimensionUnit = regex(/[A-Za-z%]+/);
const calcWhitespace = regex(/[ \t\n\r\f]+/);
const calcProductOperator = regex(/[ \t\n\r\f]*[*/][ \t\n\r\f]*/);
const calcSumOperator = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
const genericFunctionName = regex(/(?!(?:calc)(?=\())-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const charsetEncoding = regex(/[A-Za-z0-9._-]+/);
// `@import` has a plugin-owned typed fact and must not be silently lowered to
// a generic statement.  Its tail deliberately stays grammar-owned opaque CSS
// bytes: resolution belongs to a later dialect plugin, while balanced groups,
// quoted strings, and comments are still recognized here exactly once.
// `@charset` has its own grammar because its quoted encoding has narrower
// syntax than a CSS value.
const genericAtRuleName = regex(/@(?!(?:charset|import)(?=[^-_a-zA-Z0-9\u0080-\uffff]|$))-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const importAtKeyword = regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const importTailWhitespace = regex(/[ \t\n\r\f]+/);
const importTailText = regex(/[^()[\]"'\/; \t\n\r\f]+/);
const atLayer = regex(/@layer(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const layerName = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*(?:\.-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)*/);
const atKeyframes = regex(/@(?:-[a-z]+-)?keyframes(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const keyframePercent = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%/);
const keyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
const customDoubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const customSingleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const customEscape = regex(/\\[^\n\r\f]/);
const customDoubleQuoted = sequence(literal('"'), customDoubleQuotedText, literal('"'));
const customSingleQuoted = sequence(literal('\''), customSingleQuotedText, literal('\''));
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
const nestedImportTailGroup = balanced('(', ')', {
  skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted]
});
const nestedImportTailSquare = balanced('[', ']', {
  skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted]
});
const importTailGroup = sequence(
  literal('('),
  scanTo(literal(')'), {
    skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, nestedImportTailGroup]
  }),
  expect(literal(')'), ')')
);
const importTailSquareGroup = sequence(
  literal('['),
  scanTo(literal(']'), {
    skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, nestedImportTailSquare]
  }),
  expect(literal(']'), ']')
);
export const cssAstGrammar = composeLeaf([cssAstSyntax, rules<CssAstRules>({ trivia: whitespace }, (g) => {
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
  const CssAstProperty = node('CssAstProperty', g.CssAstSyntaxProperty, children => tokenText(children[0]));
  const CssAstCustomProperty = node('CssAstCustomProperty', customPropertyName, children => tokenText(children[0]));
  const CssAstCustomValue = node(
    'CssAstCustomValue',
    customValue,
    children => any(children.length === 0 ? '' : tokenText(children[0]))
  );
  const CssAstKeyword = node('CssAstKeyword', g.CssAstSyntaxKeyword, children => keyword(tokenText(children[0])));
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
      noTrivia(sequence(literal('"'), g.CssAstSyntaxDoubleQuotedText, literal('"'))),
      noTrivia(sequence(literal('\''), g.CssAstSyntaxSingleQuotedText, literal('\'')))
    ),
    (children) => {
      const quote = tokenText(children[0]);
      const value = tokenText(children[1]);
      return quoted(`${quote}${value}${quote}`, value, quote, false);
    }
  );
  const CssAstUrl = node(
    'CssAstUrl',
    sequence(g.CssAstSyntaxUrlOpen, optional(choice(g.CssAstQuoted, g.CssAstSyntaxUrlInner)), expect(literal(')'), ')')),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(children.length > 2 ? tokenText(children[1]) : ''));
    }
  );
  const CssAstCall = node(
    'CssAstCall',
    sequence(genericFunctionName, literal('('), optional(sequence(g.CssAstValueTerm, many(sequence(literal(','), g.CssAstValueTerm)))), literal(')')),
    (children) => {
      const name = tokenText(children[0]);
      return funcCall(name, children.slice(1).filter(isValue));
    }
  );
  // CSS arithmetic parentheses are structural only inside calc(), where they
  // preserve math precedence in the AST.
  const CssAstCalcParen = node(
    'CssAstCalcParen',
    noTrivia(sequence(literal('('), many(calcWhitespace), g.CssAstMathSum, many(calcWhitespace), literal(')'))),
    children => paren(valueChildren(children)[0]!)
  );
  const CssAstCalcValue = node(
    'CssAstCalcValue',
    choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstCalcCall, parser({ trivia: whitespace }, g.CssAstCall), g.CssAstCalcParen, g.CssAstQuoted, g.CssAstKeyword),
    children => valueChildren(children)[0]!
  );
  const CssAstMathProduct = node(
    'CssAstMathProduct',
    noTrivia(sequence(g.CssAstCalcValue, many(sequence(calcProductOperator, g.CssAstCalcValue)))),
    foldOperation
  );
  const CssAstMathSum = node(
    'CssAstMathSum',
    noTrivia(sequence(g.CssAstMathProduct, many(sequence(calcSumOperator, g.CssAstMathProduct)))),
    foldOperation
  );
  const CssAstCalcCall = node(
    'CssAstCalcCall',
    noTrivia(sequence(regex(/calc(?=\()/i), literal('('), many(calcWhitespace), g.CssAstMathSum, many(calcWhitespace), literal(')'))),
    children => funcCall(tokenText(children[0]), [valueChildren(children)[0]!])
  );
  const CssAstValueAtom = node(
    'CssAstValueAtom',
    choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstCalcCall, g.CssAstCall, g.CssAstQuoted, g.CssAstKeyword),
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
  const CssAstImportant = node('CssAstImportant', sequence(literal('!'), regex(/important/i)), () => true);
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
  const CssAstImportTailRaw = node(
    'CssAstImportTailRaw',
    choice(importTailGroup, importTailSquareGroup, customDoubleQuoted, customSingleQuoted, blockComment, importTailText, literal('/')),
    children => any(children.map(tokenText).join(''))
  );
  const CssAstImportTailBody = node(
    'CssAstImportTailBody',
    sequence(g.CssAstImportTailRaw, many(choice(g.CssAstImportTailRaw, importTailWhitespace))),
    children => any(children.map(sourceText).join(''))
  );
  const CssAstImportTail = node(
    'CssAstImportTail',
    noTrivia(sequence(many(importTailWhitespace), g.CssAstImportTailBody)),
    children => any(sourceText(children[children.length - 1]!))
  );
  const CssAstImport = node(
    'CssAstImport',
    sequence(importAtKeyword, choice(g.CssAstQuoted, g.CssAstUrl), optional(g.CssAstImportTail), literal(';')),
    (children) => {
      const target = children.find(isImportTarget);
      if (target === undefined) {
        throw new Error('CssAstImport requires a static quoted or url target');
      }
      return importAtRule(
        tokenText(children[0]),
        target,
        null,
        null,
        children.find((child): child is ValueNode => isNodeType(child, 'Any')) ?? null
      );
    }
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
    many(choice(g.CssAstComment, g.CssAstCharset, g.CssAstImport, g.CssAstMedia, g.CssAstLayerBlock, g.CssAstKeyframes, g.CssAstAtRuleStatement, g.CssAstRuleset)),
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
    CssAstCalcCall,
    CssAstCalcParen,
    CssAstCalcValue,
    CssAstMathProduct,
    CssAstMathSum,
    CssAstValueTerm,
    CssAstValue,
    CssAstImportant,
    CssAstDeclaration,
    CssAstCharset,
    CssAstImport,
    CssAstImportTailRaw,
    CssAstImportTailBody,
    CssAstImportTail,
    CssAstAtRuleStatement,
    CssAstLayerBlock,
    CssAstKeyframeSelector,
    CssAstKeyframeBlock,
    CssAstKeyframes,
    CssAstRuleset,
    CssAstMedia,
    whitespace
  };
})]);
