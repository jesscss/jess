/**
 * Recognition-only terminal capture for an unknown at-rule's prelude and body.
 *
 * The SCSS and Jess grammars compose this source artifact at macro build time,
 * then perform their own local AST reductions. It deliberately owns no nodes,
 * callbacks, or dialect evaluation semantics. CSS scans its own unknown at-rule
 * body directly from its canonical comment/escape/string terminals and does not
 * compose this artifact; Less scans from its own ambient skippers.
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

export const unknownAtRuleRecognition = rules(_g => ({
  /*
   * `$` is a sentinel only outside strings/comments/balanced regions.  The
   * enclosing preprocessor grammar must subsequently require `{`, rejecting
   * dynamic headers without treating raw body bytes as static opaque syntax.
   */
  PreprocessorUnknownAtRulePreludeCapture: optional(scanTo(
    choice(
      literal('$'),
      literal('{'),
      literal(';')
    ),
    { skip: preprocessorSkip }
  )),

  /*
   * An unknown at-rule's body is scanned to its closing `}` with strings,
   * comments, escapes and nested braces inert; preprocessor line comments are
   * skippable while scanning for the closing block sentinel.
   */
  PreprocessorUnknownAtRuleBodyCapture: noTrivia(scanTo(
    literal('}'),
    { skip: preprocessorSkip }
  ))
}));
