/** Private AST grammar development slice for canonical Less facts. */
import { choice, composeLeaf, field, literal, many, noTrivia, node, oneOrMore, optional, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssAstSyntax, lessAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { any, color, comment, complex, compoundOf, decl, dimension, funcCall, importAtRule, keyword, list, quoted, root, rule, selist, simple, spaced, url, varDecl, varRef } from '@jesscss/core/ast';
import type { Any, Comment, Complex, Compound, Declaration, FunctionCall, ImportAtRule, List, Quoted, Root, Rule, SelectorList, Statement, Url, ValueNode, VarDeclaration, VarRef } from '@jesscss/core/ast';

type Token = { readonly value: string };

/** Rules this file defines; macro-fused recognition inputs are not local output. */
type LessAstLocalRules = {
  LessAstDocument: Combinator<Root>;
  DirectLessImport: Combinator<ImportAtRule>;
  DirectLessVarDeclaration: Combinator<VarDeclaration>;
  DirectLessVarReference: Combinator<VarRef>;
  DirectLessKeyword: Combinator<ValueNode>;
  DirectLessColor: Combinator<ValueNode>;
  DirectLessDimension: Combinator<ValueNode>;
  DirectLessFunction: Combinator<FunctionCall>;
  DirectLessValueAtom: Combinator<ValueNode>;
  DirectLessValueTerm: Combinator<ValueNode>;
  DirectLessValue: Combinator<ValueNode>;
  DirectLessDeclaration: Combinator<Declaration>;
  DirectLessComment: Combinator<Comment>;
  DirectLessCompound: Combinator<Compound>;
  DirectLessChildComplex: Combinator<Complex>;
  DirectLessSimpleComplex: Combinator<Complex>;
  DirectLessComplex: Combinator<Complex>;
  DirectLessSelectorTail: Combinator<Complex>;
  DirectLessSelector: Combinator<SelectorList>;
  DirectLessRuleset: Combinator<Rule>;
  DirectLessQuoted: Combinator<Quoted>;
  DirectLessStaticUrl: Combinator<Url>;
  DirectLessImportOption: Combinator<Any>;
  DirectLessImportOptions: Combinator<List>;
  DirectLessStaticTail: Combinator<unknown>;
  DirectLessStaticTailGroup: Combinator<unknown>;
  DirectLessStaticTailParen: Combinator<unknown>;
  whitespace: Combinator<unknown>;
};

/** Macro-fused shared recognition plus this file's recursively defined outputs. */
type LessAstInputRules = LessAstLocalRules & typeof lessAstSyntax;

type SharedCssAstSyntax = {
  CssAstSyntaxNumber: Combinator<string>;
  CssAstSyntaxDimensionUnit: Combinator<string>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Direct Less AST grammar produced a non-token child.');
  }
  return { value: value.value };
}

function requireTerminalText(value: unknown): string {
  return typeof value === 'string' ? value : requireToken(value).value;
}

function requireField(fields: FieldMap | undefined, name: string): FieldCapture {
  const field = fields?.[name];
  if (field === undefined || Array.isArray(field)) {
    throw new TypeError(`Direct Less AST grammar lost required ${name} field.`);
  }
  return field;
}

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Direct Less AST grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

/** Reassemble only grammar-produced terminal values; never slice or rescan input. */
function staticText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isQuoted(value)) {
    return value.src;
  }
  if (Array.isArray(value)) {
    return value.map(staticText).join('');
  }
  throw new TypeError('Direct Less AST grammar produced a non-static import fragment.');
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

function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Url'
    && 'value' in value;
}

function isAny(value: unknown): value is Any {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Any'
    && 'src' in value
    && typeof value.src === 'string';
}

function isImportAtRule(value: unknown): value is ImportAtRule {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'ImportAtRule'
    && 'name' in value
    && typeof value.name === 'string'
    && 'target' in value
    && (isQuoted(value.target) || isUrl(value.target))
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
      && (value.type === 'Keyword'
        || value.type === 'Color'
        || value.type === 'Dimension'
        || value.type === 'Url'
        || value.type === 'FunctionCall'
        || value.type === 'SpacedValue'
        || value.type === 'List'));
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
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
// Semantically identical to the production Less `ampToken` terminal. A static ampersand
// is already the canonical AST representation: `Simple.text` retains `&` and
// core's selector path identifies parent references from that text.  The
// parenthesized and interpolation forms stay outside this direct static slice
// until their typed semantic payloads are constructed by grammar reductions.
const staticAmpersand = regex(/&[-_a-zA-Z0-9\u0080-\uffff]*/);
// The production Less `urlInner` terminal, narrowed only at a dynamic Less
// opener. A leading `@name` / `@{…}` belongs to the unimplemented Reference /
// interpolation path, so this direct static slice rejects it instead of
// misrepresenting it as `Any`. Other URL-token escapes and control boundaries
// remain the production terminal exactly.
const staticUrlText = regex(/(?!@(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|\{))(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
const staticTailText = regex(/[^()\[\]{};@'"]+/);
const importOption = regex(/(?:reference|optional|once|multiple|inline|css|less)(?![-\w])/i);
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
// The current direct Less subset intentionally uses the same bare identifier
// boundary as its property/keyword facts.  `url()` has its own typed node and
// is excluded so an unsupported dynamic URL cannot fall through as a generic call.
const directFunctionName = regex(/(?!(?:url)(?=\())-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);

export const lessAstGrammar = composeLeaf([cssAstSyntax, lessAstSyntax, rules<LessAstLocalRules>({ trivia: whitespace }, (g: LessAstInputRules & SharedCssAstSyntax) => {
  const DirectLessQuoted = node<Quoted>(
    'DirectLessQuoted',
    choice(
      noTrivia(sequence(literal('"'), g.LessAstSyntaxDoubleQuotedText, literal('"'))),
      noTrivia(sequence(literal('\''), g.LessAstSyntaxSingleQuotedText, literal('\'')))
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
  const DirectLessStaticUrl = node<Url>(
    'DirectLessStaticUrl',
    sequence(regex(/url\(/i), optional(choice(g.DirectLessQuoted, staticUrlText)), literal(')')),
    (children) => {
      const body = children.length === 3 ? children[1] : undefined;
      return url(body === undefined ? any('') : isQuoted(body) ? body : any(requireToken(body).value));
    }
  );
  const DirectLessImportOption = node<Any>(
    'DirectLessImportOption',
    importOption,
    children => any(requireToken(children[0]).value)
  );
  const DirectLessImportOptions = node<List>(
    'DirectLessImportOptions',
    sequence(literal('('), field('option', g.DirectLessImportOption), many(sequence(literal(','), field('option', g.DirectLessImportOption))), literal(')')),
    (_children, fields) => {
      const options = requireFields(fields, 'option').map((option) => {
        const value = option.value;
        if (!isAny(value)) {
          throw new TypeError('Direct Less AST grammar produced a non-static import option.');
        }
        return value;
      });
      return list(options, Array(options.length - 1).fill(', '));
    }
  );
  const DirectLessStaticTailParen = noTrivia(sequence(
    literal('('),
    many(choice(staticTailText, g.DirectLessQuoted, g.DirectLessStaticTailGroup)),
    literal(')')
  ));
  const DirectLessStaticTailGroup = g.DirectLessStaticTailParen;
  const DirectLessStaticTail = noTrivia(oneOrMore(choice(
    staticTailText,
    g.DirectLessQuoted,
    g.DirectLessStaticTailGroup
  )));
  const DirectLessImport = node<ImportAtRule>(
    'DirectLessImport',
    sequence(importKeyword, optional(g.DirectLessImportOptions), choice(g.DirectLessQuoted, g.DirectLessStaticUrl), optional(field('tail', g.DirectLessStaticTail)), literal(';')),
    (children, fields) => {
      // Every accepted import fact is a grammar child or a field capture. In
      // particular, the opaque tail is reconstructed from terminal values only
      // after the recursive grammar has closed every delimiter.
      const keyword = requireToken(children[0]);
      const options = children.find((child): child is List => typeof child === 'object' && child !== null && 'type' in child && child.type === 'List') ?? null;
      const target = children.find((child): child is Quoted | Url => isQuoted(child) || (typeof child === 'object' && child !== null && 'type' in child && child.type === 'Url'));
      if (target === undefined) {
        throw new TypeError('Direct Less AST grammar produced no static import target.');
      }
      const tailField = fields?.tail;
      const tail = tailField === undefined ? null : any(staticText(requireField(fields, 'tail').value));
      return importAtRule(keyword.value, target, options, null, tail);
    }
  );
  const DirectLessVarDeclaration = node<VarDeclaration>(
    'DirectLessVarDeclaration',
    sequence(literal('@'), g.LessAstSyntaxIdentifier, literal(':'), g.DirectLessValue, literal(';')),
    (children) => {
      // The sigil and name are distinct grammar children, so AST `name` is not
      // recovered from authored text or sliced from a source span.
      const name = requireToken(children[1]);
      return varDecl(name.value, requireValueNode(children[3]));
    }
  );
  const DirectLessVarReference = node<VarRef>(
    'DirectLessVarReference',
    sequence(literal('@'), g.LessAstSyntaxIdentifier),
    children => varRef(requireToken(children[1]).value)
  );
  const DirectLessKeyword = node<ValueNode>(
    'DirectLessKeyword',
    g.LessAstSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectLessColor = node<ValueNode>(
    'DirectLessColor',
    hexColor,
    children => color(requireToken(children[0]).value)
  );
  const DirectLessDimension = node<ValueNode>(
    'DirectLessDimension',
    noTrivia(sequence(g.CssAstSyntaxNumber, optional(g.CssAstSyntaxDimensionUnit))),
    (children) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const DirectLessFunction = node<FunctionCall>(
    'DirectLessFunction',
    sequence(noTrivia(sequence(directFunctionName, literal('('))), optional(g.DirectLessValueTerm), many(noTrivia(sequence(regex(/,[ \t]*/), g.DirectLessValueTerm))), literal(')')),
    (children) => {
      const name = requireToken(children[0]).value;
      const args: ValueNode[] = [];
      for (const child of children.slice(1, -1)) {
        if (isValueNode(child)) {
          args.push(child);
        }
      }
      return funcCall(name, args);
    }
  );
  const DirectLessValueAtom = node<ValueNode>(
    'DirectLessValueAtom',
    choice(g.DirectLessQuoted, g.DirectLessVarReference, g.DirectLessDimension, g.DirectLessColor, g.DirectLessStaticUrl, g.DirectLessFunction, g.DirectLessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectLessValueTerm = node<ValueNode>(
    'DirectLessValueTerm',
    oneOrMore(g.DirectLessValueAtom),
    (children) => {
      const values = children.map(requireValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessValue = node<ValueNode>(
    'DirectLessValue',
    sequence(g.DirectLessValueTerm, many(sequence(field('separator', regex(/,[ \t\n\r\f]*/)), g.DirectLessValueTerm))),
    (children, fields) => {
      const values = children.filter(isValueNode);
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      return values.length === 1 ? values[0]! : list(values, separators);
    }
  );
  const DirectLessDeclaration = node<Declaration>(
    'DirectLessDeclaration',
    sequence(g.LessAstSyntaxProperty, literal(':'), g.DirectLessValue, literal(';')),
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
    choice(simpleSelector, staticAmpersand),
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
    DirectLessColor,
    DirectLessDimension,
    DirectLessFunction,
    DirectLessValueAtom,
    DirectLessValueTerm,
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
    DirectLessStaticUrl,
    DirectLessImportOption,
    DirectLessImportOptions,
    DirectLessStaticTail,
    DirectLessStaticTailGroup,
    DirectLessStaticTailParen,
    whitespace
  };
})]);
