/**
 * Recognition-only terminal capture for opaque at-rule blocks.
 *
 * The CSS, SCSS and Jess grammars compose this source artifact at
 * macro build time, then perform their own local AST reductions.  It
 * deliberately owns no nodes, callbacks, or dialect evaluation semantics.
 */
import { balanced, choice, literal, noTrivia, optional, regex, rules, scanTo, sequence } from 'parseman' with { type: 'macro' };

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
const escape = regex(/\\[^\n\r\f]/);
const doubleQuoted = sequence(
  literal('"'),
  regex(/(?:[^"\\]|\\[\s\S])*/),
  literal('"')
);
const singleQuoted = sequence(
  literal('\''),
  regex(/(?:[^'\\]|\\[\s\S])*/),
  literal('\'')
);

const cssBrace = balanced(
  '{',
  '}',
  { skip: [blockComment, escape, doubleQuoted, singleQuoted] }
);
const cssSkip = [blockComment, escape, doubleQuoted, singleQuoted, cssBrace];

/*
 * SCSS and Jess share one preprocessor capture: both add `//` line comments to
 * the skip set and both reserve a top-level `$` for their own variable syntax.
 */
const preprocessorBrace = balanced(
  '{',
  '}',
  { skip: [blockComment, lineComment, escape, doubleQuoted, singleQuoted] }
);
const preprocessorSkip = [blockComment, lineComment, escape, doubleQuoted, singleQuoted, preprocessorBrace];

export const opaqueAtRuleRecognition = rules(_g => ({
  OpaqueAtRulePreludeCapture: optional(scanTo(
    choice(
      literal('{'),
      literal(';')
    ),
    { skip: cssSkip }
  )),
  OpaqueAtRuleBodyCapture: noTrivia(scanTo(
    literal('}'),
    { skip: cssSkip }
  )),

  /*
   * `$` is a sentinel only outside strings/comments/balanced regions.  The
   * enclosing preprocessor grammar must subsequently require `{`, rejecting
   * dynamic headers without treating raw body bytes as static opaque syntax.
   */
  PreprocessorOpaqueAtRulePreludeCapture: optional(scanTo(
    choice(
      literal('$'),
      literal('{'),
      literal(';')
    ),
    { skip: preprocessorSkip }
  )),

  /*
   * The body capture differs from CSS only in trivia ownership: preprocessor
   * line comments are skippable while scanning for the closing block sentinel.
   */
  PreprocessorOpaqueAtRuleBodyCapture: noTrivia(scanTo(
    literal('}'),
    { skip: preprocessorSkip }
  ))
}));
