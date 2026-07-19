/**
 * Private direct-AST starter for Jess declarations.
 *
 * This deliberately does not compose the public CST grammar or expose a parser
 * entrypoint.  Parseman reductions construct the canonical core facts directly.
 */
import { choice, composeLeaf, literal, many, noTrivia, node, optional, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { decl, dimension, funcCall, keyword, quoted, root, rule, varDecl, varRef } from '@jesscss/core/ast';
import type { Declaration, Dimension, FunctionCall, Keyword, Quoted, Root, Rule, Statement, ValueNode, VarDeclaration, VarRef } from '@jesscss/core/ast';

type Token = { readonly value: string };

type JessAstRules = {
  JessAstDocument: Combinator<Root>;
  DirectJessVarDeclaration: Combinator<VarDeclaration>;
  DirectJessVarReference: Combinator<VarRef>;
  DirectJessKeyword: Combinator<Keyword>;
  DirectJessQuoted: Combinator<Quoted>;
  DirectJessDimension: Combinator<Dimension>;
  DirectJessCallArgument: Combinator<ValueNode>;
  DirectJessCall: Combinator<FunctionCall>;
  DirectJessValue: Combinator<ValueNode>;
  DirectJessDeclaration: Combinator<Declaration>;
  DirectJessRule: Combinator<Rule>;
  whitespace: Combinator<unknown>;
};

type SharedCssAstSyntax = {
  CssAstSyntaxKeyword: Combinator<string>;
  CssAstSyntaxNumber: Combinator<string>;
  CssAstSyntaxDimensionUnit: Combinator<string>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-token child.');
  }
  const token = value as { readonly value: unknown };
  if (typeof token.value !== 'string') {
    throw new TypeError('Direct Jess AST grammar produced a non-token child.');
  }
  return { value: token.value };
}

function isValueNode(value: unknown): value is ValueNode {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'Keyword' || value.type === 'Quoted' || value.type === 'VarRef' || value.type === 'Dimension' || value.type === 'FunctionCall');
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-value child.');
  }
  return value;
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isVarDeclaration(child) && !isRule(child)) {
      throw new TypeError('Direct Jess AST grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isValueNode(value.value);
}

function isRule(value: unknown): value is Rule {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Rule';
}

function requireDeclarations(children: readonly unknown[]): Declaration[] {
  const declarations: Declaration[] = [];
  for (const child of children) {
    if (!isDeclaration(child)) {
      throw new TypeError('Direct Jess AST grammar produced a non-declaration rule child.');
    }
    declarations.push(child);
  }
  return declarations;
}

function requireExactToken(value: unknown, expected: string): void {
  if (requireToken(value).value !== expected) {
    throw new TypeError(`Direct Jess AST grammar produced ${requireToken(value).value} where ${expected} was required.`);
  }
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

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
// The direct starter intentionally leaves Jess escape semantics to its next
// slice. These closed text leaves reject escapes rather than claiming a decoded
// value or an `escaped` flag that this grammar does not yet construct.
const plainDoubleQuotedText = regex(/[^"\\]*/);
const plainSingleQuotedText = regex(/[^'\\]*/);
// Jess's live `$` grammar does not permit CSS escapes in names. Keep that
// dialect-local fact explicit while the value keyword leaf remains shared.
const jessDollarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);

export const jessAstGrammar = composeLeaf([cssAstSyntax, rules<JessAstRules>({ trivia: whitespace }, (g: JessAstRules & SharedCssAstSyntax) => {
  const DirectJessQuoted = node<Quoted>(
    'DirectJessQuoted',
    choice(
      sequence(literal('"'), plainDoubleQuotedText, literal('"')),
      sequence(literal('\''), plainSingleQuotedText, literal('\''))
    ),
    (children) => {
      const open = requireToken(children[0]);
      const content = requireToken(children[1]);
      return quoted(`${open.value}${content.value}${open.value}`, content.value, open.value, false);
    }
  );
  const DirectJessVarReference = node<VarRef>(
    'DirectJessVarReference',
    sequence(literal('$'), jessDollarName),
    children => varRef(requireToken(children[1]).value)
  );
  const DirectJessKeyword = node<Keyword>(
    'DirectJessKeyword',
    g.CssAstSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectJessDimension = node<Dimension>(
    'DirectJessDimension',
    noTrivia(sequence(g.CssAstSyntaxNumber, optional(g.CssAstSyntaxDimensionUnit))),
    (children) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const DirectJessCallArgument = node<ValueNode>(
    'DirectJessCallArgument',
    sequence(literal(','), g.DirectJessValue),
    (children) => {
      if (children.length !== 2 || requireToken(children[0]).value !== ',') {
        throw new TypeError('Direct Jess AST call argument produced unexpected children.');
      }
      return requireValueNode(children[1]);
    }
  );
  // A direct static call owns its argument boundaries and recursive call shape.
  // Dynamic Jess `$[...]` interpolation, arithmetic expressions, and named
  // arguments remain outside this closed slice until they have typed reductions.
  const DirectJessCall = node<FunctionCall>(
    'DirectJessCall',
    sequence(
      g.CssAstSyntaxKeyword,
      literal('('),
      optional(sequence(g.DirectJessValue, many(g.DirectJessCallArgument))),
      literal(')')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children.at(-1)).value !== ')') {
        throw new TypeError('Direct Jess AST call produced unexpected children.');
      }
      const args: ValueNode[] = [];
      for (let index = 2; index < children.length - 1; index += 1) {
        args.push(requireValueNode(children[index]));
      }
      return funcCall(requireToken(children[0]).value, args);
    }
  );
  const DirectJessValue = node<ValueNode>(
    'DirectJessValue',
    choice(g.DirectJessCall, g.DirectJessVarReference, g.DirectJessQuoted, g.DirectJessDimension, g.DirectJessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectJessVarDeclaration = node<VarDeclaration>(
    'DirectJessVarDeclaration',
    sequence(literal('$'), jessDollarName, literal(':'), g.DirectJessValue, literal(';')),
    children => varDecl(requireToken(children[1]).value, requireValueNode(children[3]))
  );
  // This is a deliberately named subset, not a general static-selector route:
  // one shared CSS basic selector token (`.card`, `#id`, `button`, `*`) followed
  // by static properties and the already-typed closed value subset. Pseudos,
  // attributes, ampersands, percentage selectors, compound/combinator selectors,
  // and Jess `$[...]` interpolation each need their own typed reductions.
  const DirectJessDeclaration = node<Declaration>(
    'DirectJessDeclaration',
    sequence(g.CssAstSyntaxProperty, literal(':'), g.DirectJessValue, literal(';')),
    children => decl(requireToken(children[0]).value, requireValueNode(children[2]))
  );
  const DirectJessRule = node<Rule>(
    'DirectJessRule',
    sequence(g.CssAstSyntaxSimple, literal('{'), many(g.DirectJessDeclaration), literal('}')),
    (children) => {
      requireExactToken(children[1], '{');
      requireExactToken(children.at(-1), '}');
      return rule(requireToken(children[0]).value, requireDeclarations(children.slice(2, -1)));
    }
  );
  const JessAstDocument = node<Root>(
    'JessAstDocument',
    many(choice(g.DirectJessVarDeclaration, g.DirectJessRule)),
    children => root(requireStatements(children))
  );

  return {
    JessAstDocument,
    DirectJessVarDeclaration,
    DirectJessVarReference,
    DirectJessKeyword,
    DirectJessQuoted,
    DirectJessDimension,
    DirectJessCallArgument,
    DirectJessCall,
    DirectJessValue,
    DirectJessDeclaration,
    DirectJessRule,
    whitespace
  };
})]);
