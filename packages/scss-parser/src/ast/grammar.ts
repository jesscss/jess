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
import { any, color, decl, dimension, funcCall, keyword, list, quoted, root, rule, spaced, url, varDecl, varRef } from '@jesscss/core/ast';
import type { Color, Declaration, Dimension, FunctionCall, Keyword, Quoted, Root, Rule, Statement, ValueNode, VarDeclaration, VarRef } from '@jesscss/core/ast';

type Token = { readonly value: string };
type ScssValuePair = { readonly separator: string; readonly value: ValueNode };

type ScssAstRules = {
  ScssAstDocument: Combinator<Root>;
  DirectScssVarDeclaration: Combinator<VarDeclaration>;
  DirectScssVarReference: Combinator<VarRef>;
  DirectScssQuoted: Combinator<Quoted>;
  DirectScssKeyword: Combinator<Keyword>;
  DirectScssColor: Combinator<Color>;
  DirectScssDimension: Combinator<Dimension>;
  DirectScssUrl: Combinator<ValueNode>;
  DirectScssCall: Combinator<FunctionCall>;
  DirectScssCallArgument: Combinator<ValueNode>;
  DirectScssValueAtom: Combinator<ValueNode>;
  DirectScssValueTerm: Combinator<ValueNode>;
  DirectScssValuePair: Combinator<ScssValuePair>;
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

function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'FunctionCall'
    && 'name' in value
    && typeof value.name === 'string'
    && 'args' in value
    && Array.isArray(value.args);
}

function isValue(value: unknown): value is ValueNode {
  return isQuoted(value)
    || isVarRef(value)
    || isColor(value)
    || isDimension(value)
    || isFunctionCall(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'Any'
      && 'src' in value && typeof value.src === 'string')
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'Url'
      && 'value' in value && isValue(value.value))
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'SpacedValue'
      && 'parts' in value && Array.isArray(value.parts))
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'List'
      && 'items' in value && Array.isArray(value.items))
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

function isScssValuePair(value: unknown): value is ScssValuePair {
  return typeof value === 'object'
    && value !== null
    && 'separator' in value
    && typeof value.separator === 'string'
    && 'value' in value
    && isValue(value.value);
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
  // A closed static value must not split an unsupported escaped `$` reference
  // into a valid short reference plus a following keyword in a space sequence.
  // The legacy scanner accepts no backslash in this token either; the boundary
  // makes that rejection atomic in this direct grammar.
  const scssVarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?![-_a-zA-Z0-9\u0080-\uffff\\])/);
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
  // The legacy URL lexical body permits ordinary `#` bytes, but an interpolation
  // opener has its own typed SCSS production. This closed static branch must not
  // flatten it into `Any`, so `#{` is excluded by grammar rather than a post-parse
  // inspection.
  const staticUrlInner = regex(/(?:[^\"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F#]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|#(?!\{))+/);
  const DirectScssUrl = node<ValueNode>(
    'DirectScssUrl',
    sequence(g.CssAstSyntaxUrlOpen, optional(choice(g.DirectScssQuoted, staticUrlInner)), literal(')')),
    (children) => {
      if (children.length === 2) {
        if (requireToken(children[0]).value.toLowerCase() !== 'url(' || requireToken(children[1]).value !== ')') {
          throw new TypeError('DirectScssUrl produced unexpected children.');
        }
        return url(any(''));
      }
      if (children.length !== 3 || requireToken(children[0]).value.toLowerCase() !== 'url(' || requireToken(children[2]).value !== ')') {
        throw new TypeError('DirectScssUrl produced unexpected children.');
      }
      const body = children[1];
      return url(isValue(body) ? body : any(requireToken(body).value));
    }
  );
  const DirectScssCallArgument = node<ValueNode>(
    'DirectScssCallArgument',
    noTrivia(sequence(literal(','), optional(regex(/[ \t\n\r\f]+/)), g.DirectScssValueTerm)),
    (children) => {
      if (children.length !== 2 && children.length !== 3) {
        throw new TypeError('DirectScssCallArgument produced unexpected children.');
      }
      if (requireToken(children[0]).value !== ',') {
        throw new TypeError('DirectScssCallArgument lost its comma.');
      }
      const value = children[children.length - 1];
      return requireValue(value);
    }
  );
  const DirectScssCall = node<FunctionCall>(
    'DirectScssCall',
    sequence(
      g.CssAstSyntaxKeyword,
      literal('('),
      optional(sequence(g.DirectScssValueTerm, many(g.DirectScssCallArgument))),
      literal(')')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children[children.length - 1]).value !== ')') {
        throw new TypeError('DirectScssCall produced unexpected children.');
      }
      const args: ValueNode[] = [];
      for (let index = 2; index < children.length - 1; index += 1) {
        args.push(requireValue(children[index]));
      }
      return funcCall(requireToken(children[0]).value, args);
    }
  );
  const DirectScssValueAtom = node<ValueNode>(
    'DirectScssValueAtom',
    choice(g.DirectScssQuoted, g.DirectScssVarReference, g.DirectScssColor, g.DirectScssDimension, g.DirectScssUrl, g.DirectScssCall, g.DirectScssKeyword),
    children => requireValue(children[0])
  );
  const DirectScssValueTerm = node<ValueNode>(
    'DirectScssValueTerm',
    // A static space-list needs an authored separator. With ambient trivia,
    // adjacent atoms would otherwise turn `17px-1px` into two dimensions and
    // silently model an unimplemented arithmetic form as a list.
    noTrivia(sequence(g.DirectScssValueAtom, many(sequence(regex(/[ \t\n\r\f]+/), g.DirectScssValueAtom)))),
    (children) => {
      const values = [requireValue(children[0])];
      for (let index = 1; index < children.length; index += 2) {
        const separator = requireToken(children[index]).value;
        if (separator.length === 0 || index + 1 >= children.length) {
          throw new TypeError('Direct SCSS AST value term produced an invalid separator.');
        }
        values.push(requireValue(children[index + 1]));
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectScssValuePair = node<ScssValuePair>(
    'DirectScssValuePair',
    noTrivia(sequence(literal(','), optional(regex(/[ \t\n\r\f]+/)), g.DirectScssValueTerm)),
    (children) => {
      if (children.length !== 2 && children.length !== 3) {
        throw new TypeError('DirectScssValuePair produced unexpected children.');
      }
      if (requireToken(children[0]).value !== ',') {
        throw new TypeError('DirectScssValuePair lost its comma.');
      }
      const separator = children.length === 3
        ? `,${requireToken(children[1]).value}`
        : ',';
      return { separator, value: requireValue(children[children.length - 1]) };
    }
  );
  const DirectScssValue = node<ValueNode>(
    'DirectScssValue',
    sequence(g.DirectScssValueTerm, many(g.DirectScssValuePair)),
    (children) => {
      const first = requireValue(children[0]);
      if (children.length === 1) {
        return first;
      }
      const pairs: ScssValuePair[] = [];
      for (let index = 1; index < children.length; index += 1) {
        if (!isScssValuePair(children[index])) {
          throw new TypeError('Direct SCSS AST value produced a non-list child.');
        }
        pairs.push(children[index]);
      }
      return list([first, ...pairs.map(pair => pair.value)], pairs.map(pair => pair.separator));
    }
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
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '{' || requireToken(children[children.length - 1]).value !== '}') {
        throw new TypeError('DirectScssRule produced unexpected children.');
      }
      const body: Declaration[] = [];
      for (let index = 2; index < children.length - 1; index += 1) {
        const declaration = children[index];
        if (!isDeclaration(declaration)) {
          throw new TypeError('DirectScssRule produced a non-declaration child.');
        }
        body.push(declaration);
      }
      return rule(requireToken(children[0]).value, body);
    }
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
    DirectScssUrl,
    DirectScssCall,
    DirectScssCallArgument,
    DirectScssValueAtom,
    DirectScssValueTerm,
    DirectScssValuePair,
    DirectScssValue,
    DirectScssDeclaration,
    DirectScssRule,
    whitespace
  };
})]);
