/**
 * Shared, dialect-invariant pseudo-argument recognition rules.
 *
 * Every rule here is built with grammar-free lexical combinators: no `g.`
 * reference and no AST reduction. That `g`-freedom is what lets a consuming
 * dialect grammar inline them at its own macro-fusion site. They are exposed as
 * a composable recognition artifact (the same shape as `cssSyntax` in
 * `recognition.ts` and `opaqueAtRuleRecognition`), so a direct-AST grammar
 * fuses them through `composeLeaf([...])` and references each via `g.<name>`.
 * parseman cannot inline a bare cross-module combinator const used inside a
 * rules body; the `rules()` recognition-map shape is the proven cross-package
 * mechanism.
 *
 * These consolidate the previously divergent nth-name boundaries and the
 * `of`/close lookaheads. The An+B leaf `CssSyntaxNth` and the
 * `CssSyntaxMalformedPseudoNumericArgument` gate live in `recognition.ts`
 * and are reused from there — they are not duplicated here.
 */
import { regex, rules, word } from 'parseman' with { type: 'macro' };

/** `:nth-child(` / `:nth-last-child(` name, boundary-anchored on the `(`. */
const nthChildNameWithArg = regex(/nth-(?:last-)?child(?=\()/i);

/** `:nth-of-type(` / `:nth-last-of-type(` name, boundary-anchored on the `(`. */
const nthTypeNameWithArg = regex(/nth-(?:last-)?of-type(?=\()/i);

/**
 * Every `:nth-*` family name, anchored on the IDENTIFIER boundary rather than a
 * following `(`. A generic keyword-pseudo arm excludes this so a paren-less nth
 * name (`:nth-child`, `:nth-of-type`) cannot be reclassified as a bare keyword
 * pseudo — it must reach the structured nth arms with an immediate `(` or be
 * rejected. This is the shared form of Less's `directStaticNthPseudoNameBoundary`.
 */
const nthNameBoundary = regex(/nth-(?:last-)?(?:child|of-type)(?![-_a-zA-Z0-9-\uFFFF])/i);

/**
 * The selector-argument functional pseudos (`:is`/`:where`/`:not`/`:has`/
 * `:matches`), anchored on the opening `(`. A dialect routes these names to a
 * selector-ONLY argument (no general-any fallback), so a non-selector argument
 * such as `:not(2n+1)` fails the selector and rejects the whole pseudo. The
 * generic keyword-pseudo arm excludes these so a failed selector cannot fall
 * through to the general-any scan.
 */
const selectorArgPseudoName = regex(/(?:is|where|not|has|matches)(?=\()/i);

/** The `of` keyword introducing a `<selector>` in an nth-child argument. */
const pseudoOfKeyword = word(
  'of',
  '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
  { caseInsensitive: true }
);

/** Zero-width close check: whitespace-tolerant lookahead at the argument `)`. */
const pseudoCloseAhead = regex(/(?=[ \t\n\r\f]*\))/i);

export const cssPseudoSyntax = rules(_g => ({
  CssSyntaxNthChildName: nthChildNameWithArg,
  CssSyntaxNthTypeName: nthTypeNameWithArg,
  CssSyntaxNthName: nthNameBoundary,
  CssSyntaxSelectorArgPseudoName: selectorArgPseudoName,
  CssSyntaxOfKeyword: pseudoOfKeyword,
  CssSyntaxPseudoCloseAhead: pseudoCloseAhead
}));
