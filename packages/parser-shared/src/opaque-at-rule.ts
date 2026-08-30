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
 * The structured spelling of the SAME body language `cssBrace`/`cssSkip` scan.
 * `OpaqueAtRuleBodyCapture` recognises an unknown at-rule's block exactly as
 * css-syntax-3 §5.4.2 defines it — a simple block of component values, with
 * braces balanced and strings/comments/escapes inert — but reduces the whole
 * span to one terminal, so a consumer gets bytes and no interior. These arms
 * recognise the identical byte language as a nesting of parts, so the CST can
 * carry the block's brace structure while the AST keeps the same raw bytes.
 *
 * The stop set is deliberately the stop set of `cssSkip`, not a better one.
 * `(`/`[` are NOT balanced here because `cssSkip` does not balance them, and a
 * capture that agreed with the spec but disagreed with the scan it replaces
 * would change which sources parse.
 *
 * `opaqueStray` is what keeps the replacement total: `scanTo` walks past a
 * quote whose partner never arrives by treating it as an ordinary byte, so an
 * unpaired `'`/`"` must have an arm here or a body that parses today would
 * stop parsing.
 */
const opaqueText = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/'"{}]+)+/);
const opaqueStray = regex(/['"]/);

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
  OpaqueBodyText: noTrivia(opaqueText),
  OpaqueBodyComment: noTrivia(blockComment),
  OpaqueBodyQuoted: noTrivia(choice(doubleQuoted, singleQuoted)),
  OpaqueBodyStray: noTrivia(opaqueStray),

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
