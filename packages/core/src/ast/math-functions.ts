/**
 * The css-values-4 §10 math functions — ONE table, for every consumer.
 *
 * `calc()` computes nothing. It is a SPELLING the parser recognises so the
 * operations written inside it keep their authorship instead of being folded
 * away (§4.6). Every other name here has exactly the same relationship to the
 * grammar, which is why they belong in one list rather than in a `calc`-shaped
 * production plus five hand-rolled copies: before this file `'calc'` was
 * spelled independently in the four grammar dispatch tables, in the css
 * grammar's `genericFunctionIdentifier` regex lookahead, and in three places in
 * core.
 *
 * SCOPE — css-values-4 ONLY (owner, 2026-08-01). css-values-5 adds `calc-size`,
 * `progress`, `media-progress`, `container-progress`, `random`, and the
 * argument-less `sibling-count` / `sibling-index`; NONE of them are recognised.
 * Nothing enters this table until it ships in browsers, gated PER FUNCTION and
 * verified at implementation time. Leaving one out costs almost nothing — an
 * unrecognised name falls through to the generic call tail and emits verbatim,
 * so the only consequence is that its arguments are not parsed as math, and
 * nobody writes math inside a function that does not exist yet. Adding one
 * early is the costlier direction: it claims syntax that may still change, and
 * every routed name carries generated-code weight (each dispatch tail is
 * INLINED per artifact).
 *
 * Names are lowercase; CSS function names are ASCII-case-insensitive and every
 * consumer matches case-insensitively.
 */
export const CSS_MATH_FUNCTIONS = [
  'calc',

  /* comparison */
  'min',
  'max',
  'clamp',

  /* stepped-value */
  'round',
  'mod',
  'rem',

  /* trigonometric */
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',

  /* exponential */
  'pow',
  'sqrt',
  'hypot',
  'log',
  'exp',

  /* sign-related */
  'abs',
  'sign'
] as const;

/**
 * The same table as glued FUNCTION OPENERS, which is the token a grammar
 * dispatch actually routes on (`min(`), not the bare name.
 *
 * Spelled as one array so a dispatch table spends ONE multi-key arm. Twenty
 * separate arms would inline twenty copies of the same tail — measured at
 * roughly 1.4 MB of generated code across the css and jess artifacts against
 * roughly 70 KB for the multi-key form.
 */
export const CSS_MATH_FUNCTION_OPENERS: readonly string[] = CSS_MATH_FUNCTIONS.map(name => `${name}(`);

const MATH_FUNCTION_SET: ReadonlySet<string> = new Set<string>(CSS_MATH_FUNCTIONS);

/**
 * Is `name` a css-values-4 §10 math function? Case-insensitive, per CSS
 * function-name matching.
 */
export function isMathFunctionName(name: string): boolean {
  return MATH_FUNCTION_SET.has(name.toLowerCase());
}
