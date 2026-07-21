/**
 * Recognition-only terminal capture for opaque at-rule blocks.
 *
 * The direct CSS and Jess AST grammars compose this source artifact at macro
 * build time, then perform their own local AST reductions.  It deliberately
 * owns no nodes, callbacks, or dialect evaluation semantics.
 */
import { balanced, choice, literal, noTrivia, optional, regex, rules, scanTo, sequence } from 'parseman' with { type: 'macro' };

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
const escape = regex(/\\[^\n\r\f]/);
const doubleQuoted = sequence(literal('"'), regex(/(?:[^"\\]|\\[\s\S])*/), literal('"'));
const singleQuoted = sequence(literal('\''), regex(/(?:[^'\\]|\\[\s\S])*/), literal('\''));

const cssBrace = balanced('{', '}', { skip: [blockComment, escape, doubleQuoted, singleQuoted] });
const cssSkip = [blockComment, escape, doubleQuoted, singleQuoted, cssBrace];
const jessBrace = balanced('{', '}', { skip: [blockComment, lineComment, escape, doubleQuoted, singleQuoted] });
const jessSkip = [blockComment, lineComment, escape, doubleQuoted, singleQuoted, jessBrace];

export const opaqueAtRuleRecognition = rules(_g => ({
  CssAstOpaqueCapturePrelude: optional(scanTo(choice(literal('{'), literal(';')), { skip: cssSkip })),
  CssAstOpaqueCaptureBody: noTrivia(scanTo(literal('}'), { skip: cssSkip })),
  // `$` is a sentinel only outside strings/comments/balanced regions.  The
  // enclosing Jess grammar must subsequently require `{`, rejecting dynamic
  // headers without treating raw body bytes as Jess syntax.
  JessAstOpaqueStaticPrelude: optional(scanTo(choice(literal('$'), literal('{'), literal(';')), { skip: jessSkip })),
  JessAstOpaqueBody: noTrivia(scanTo(literal('}'), { skip: jessSkip }))
}));
