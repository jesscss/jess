/**
 * Private direct-AST starter for Jess declarations.
 *
 * This deliberately does not compose the public CST grammar or expose a parser
 * entrypoint.  Parseman reductions construct the canonical core facts directly.
 */
import { choice, composeLeaf, literal, many, node, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { keyword, quoted, root, varDecl, varRef } from '@jesscss/core/ast';
import type { Keyword, Quoted, Root, Statement, ValueNode, VarDeclaration, VarRef } from '@jesscss/core/ast';

type Token = { readonly value: string };

type JessAstRules = {
  JessAstDocument: Combinator<Root>;
  DirectJessVarDeclaration: Combinator<VarDeclaration>;
  DirectJessVarReference: Combinator<VarRef>;
  DirectJessKeyword: Combinator<Keyword>;
  DirectJessQuoted: Combinator<Quoted>;
  DirectJessValue: Combinator<ValueNode>;
  whitespace: Combinator<unknown>;
};

type SharedCssAstSyntax = {
  CssAstSyntaxKeyword: Combinator<string>;
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
    && (value.type === 'Keyword' || value.type === 'Quoted' || value.type === 'VarRef');
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
    if (!isVarDeclaration(child)) {
      throw new TypeError('Direct Jess AST grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
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
  const DirectJessValue = node<ValueNode>(
    'DirectJessValue',
    choice(g.DirectJessVarReference, g.DirectJessQuoted, g.DirectJessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectJessVarDeclaration = node<VarDeclaration>(
    'DirectJessVarDeclaration',
    sequence(literal('$'), jessDollarName, literal(':'), g.DirectJessValue, literal(';')),
    children => varDecl(requireToken(children[1]).value, requireValueNode(children[3]))
  );
  const JessAstDocument = node<Root>(
    'JessAstDocument',
    many(g.DirectJessVarDeclaration),
    children => root(requireStatements(children))
  );

  return {
    JessAstDocument,
    DirectJessVarDeclaration,
    DirectJessVarReference,
    DirectJessKeyword,
    DirectJessQuoted,
    DirectJessValue,
    whitespace
  };
})]);
