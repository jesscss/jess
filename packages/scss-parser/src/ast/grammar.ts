/**
 * Private direct SCSS AST construction proof.
 *
 * This grammar is intentionally closed: it proves that SCSS reductions can
 * construct the canonical AST without a CST semantic host or a parser bridge.
 * It is not a public parsing route.
 */
import { choice, composeLeaf, literal, many, noTrivia, node, optional, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { color, decl, dimension, keyword, quoted, root, rule, varDecl, varRef } from '@jesscss/core/ast';
import type { Color, Declaration, Dimension, Keyword, Quoted, Root, Rule, Statement, ValueNode, VarDeclaration, VarRef } from '@jesscss/core/ast';

type Token = { readonly value: string };

type ScssAstRules = {
  ScssAstDocument: Combinator<Root>;
  DirectScssVarDeclaration: Combinator<VarDeclaration>;
  DirectScssVarReference: Combinator<VarRef>;
  DirectScssQuoted: Combinator<Quoted>;
  DirectScssKeyword: Combinator<Keyword>;
  DirectScssColor: Combinator<Color>;
  DirectScssDimension: Combinator<Dimension>;
  DirectScssValue: Combinator<ValueNode>;
  DirectScssDeclaration: Combinator<Declaration>;
  DirectScssRule: Combinator<Rule>;
  whitespace: Combinator<unknown>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Direct SCSS AST grammar produced a non-token child.');
  }
  return { value: value.value };
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

function isVarRef(value: unknown): value is VarRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VarRef'
    && 'name' in value
    && typeof value.name === 'string';
}

function isColor(value: unknown): value is Color {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Color'
    && 'src' in value
    && typeof value.src === 'string';
}

function isDimension(value: unknown): value is Dimension {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Dimension'
    && 'number' in value
    && typeof value.number === 'number'
    && 'unit' in value
    && typeof value.unit === 'string'
    && 'src' in value
    && typeof value.src === 'string';
}

function isValue(value: unknown): value is ValueNode {
  return isQuoted(value)
    || isVarRef(value)
    || isColor(value)
    || isDimension(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'Keyword'
      && 'src' in value && typeof value.src === 'string');
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isValue(value.value);
}

function isRule(value: unknown): value is Rule {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Rule';
}

function requireValue(value: unknown): ValueNode {
  if (!isValue(value)) {
    throw new TypeError('Direct SCSS AST grammar produced a non-value child.');
  }
  return value;
}

function isVarDeclaration(value: unknown): value is VarDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VarDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isValue(value.value);
}

function statements(children: readonly unknown[]): Statement[] {
  const result: Statement[] = [];
  for (const child of children) {
    if (!isVarDeclaration(child) && !isRule(child)) {
      throw new TypeError('Direct SCSS AST grammar produced a non-statement child.');
    }
    result.push(child);
  }
  return result;
}

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
// Match the legacy CSS/SCSS color token exactly: only 3, 4, 6, or 8 hex
// digits, with a negative lookahead so a longer hex run cannot be truncated
// into an incorrectly typed Color.
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);

export const scssAstGrammar = composeLeaf([cssAstSyntax, rules<ScssAstRules>({ trivia: whitespace }, (g) => {
  // SCSS owns the token after its `$` sigil. The shared CSS keyword leaf is
  // valid for closed value facts, but admits CSS escapes that SCSS variables do
  // not: `scssVar` in the production grammar is deliberately unescaped.
  const scssVarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  // The shared CSS quoted leaves deliberately accept arbitrary text, including
  // SCSS interpolation. This closed starter has no typed Interp reduction yet,
  // so each chunk stops only at a real `#{` opener; ordinary `#foo` remains
  // literal text and escapes stay grammar-recognized.
  const directDoubleQuotedText = regex(/(?:[^"\\#]|\\[\s\S]|#(?!\{))*/);
  const directSingleQuotedText = regex(/(?:[^'\\#]|\\[\s\S]|#(?!\{))*/);
  const DirectScssQuoted = node<Quoted>(
    'DirectScssQuoted',
    choice(
      sequence(literal('"'), directDoubleQuotedText, literal('"')),
      sequence(literal('\''), directSingleQuotedText, literal('\''))
    ),
    (children) => {
      const quote = requireToken(children[0]).value;
      const value = requireToken(children[1]).value;
      return quoted(`${quote}${value}${quote}`, value, quote, value.includes('\\'));
    }
  );
  const DirectScssVarReference = node<VarRef>(
    'DirectScssVarReference',
    sequence(literal('$'), scssVarName),
    children => varRef(requireToken(children[1]).value)
  );
  const DirectScssKeyword = node<Keyword>(
    'DirectScssKeyword',
    g.CssAstSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectScssColor = node<Color>(
    'DirectScssColor',
    hexColor,
    children => color(requireToken(children[0]).value)
  );
  const DirectScssDimension = node<Dimension>(
    'DirectScssDimension',
    noTrivia(sequence(g.CssAstSyntaxNumber, optional(g.CssAstSyntaxDimensionUnit))),
    (children) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const DirectScssValue = node<ValueNode>(
    'DirectScssValue',
    choice(g.DirectScssQuoted, g.DirectScssVarReference, g.DirectScssColor, g.DirectScssDimension, g.DirectScssKeyword),
    children => requireValue(children[0])
  );
  const DirectScssVarDeclaration = node<VarDeclaration>(
    'DirectScssVarDeclaration',
    sequence(literal('$'), scssVarName, literal(':'), g.DirectScssValue, literal(';')),
    children => varDecl(requireToken(children[1]).value, requireValue(children[3]))
  );
  const DirectScssDeclaration = node<Declaration>(
    'DirectScssDeclaration',
    sequence(g.CssAstSyntaxProperty, literal(':'), g.DirectScssValue, literal(';')),
    children => decl(requireToken(children[0]).value, requireValue(children[2]))
  );
  const DirectScssRule = node<Rule>(
    'DirectScssRule',
    sequence(g.CssAstSyntaxSimple, literal('{'), many(g.DirectScssDeclaration), literal('}')),
    children => rule(requireToken(children[0]).value, children.filter(isDeclaration))
  );
  const ScssAstDocument = node<Root>(
    'ScssAstDocument',
    many(choice(g.DirectScssVarDeclaration, g.DirectScssRule)),
    children => root(statements(children))
  );

  return {
    ScssAstDocument,
    DirectScssVarDeclaration,
    DirectScssVarReference,
    DirectScssQuoted,
    DirectScssKeyword,
    DirectScssColor,
    DirectScssDimension,
    DirectScssValue,
    DirectScssDeclaration,
    DirectScssRule,
    whitespace
  };
})]);
