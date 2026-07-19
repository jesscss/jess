/** Closed direct AST-v2 grammar for the simplest Less import fact. */
import { choice, literal, many, node, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { AstQuoted, ImportAtRule, Root, Statement, VarDeclaration } from '@jesscss/core/ast';

type Token = { readonly value: string };

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Direct Less AST grammar produced a non-token child.');
  }
  return value;
}

function isAstQuoted(value: unknown): value is AstQuoted {
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

function requireAstQuoted(value: unknown): AstQuoted {
  if (!isAstQuoted(value)) {
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
    && isAstQuoted(value.target)
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
    && isAstQuoted(value.value);
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isImportAtRule(child) && !isVarDeclaration(child)) {
      throw new TypeError('Direct Less AST grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
}

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const importKeyword = regex(/@(?:-import|-export|import)(?![-\w])/i);
const variableName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const doubleQuotedText = regex(/[^"\\]*/);
const singleQuotedText = regex(/[^'\\]*/);

export const directLessAstGrammar = rules({ trivia: whitespace }, (g: any) => {
  const DirectLessQuoted = node<AstQuoted>(
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
      const target = requireAstQuoted(children[1]);
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
      const value = requireAstQuoted(children[3]);
      return { type: 'VarDeclaration', name: name.value, value };
    }
  );
  const DirectLessDocument = node<Root>(
    'DirectLessDocument',
    many(choice(g.DirectLessImport, g.DirectLessVarDeclaration)),
    children => ({ type: 'Root', children: requireStatements(children) })
  );

  return { DirectLessDocument, DirectLessImport, DirectLessVarDeclaration, DirectLessQuoted, whitespace };
});
