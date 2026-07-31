/**
 * Root-trivia label selection for the CSS grammar.
 *
 * This is a plain fact about the grammar's trivia arm labels, so it lives in a
 * leaf module with no imports. Reading it from the CST entry instead would make
 * every consumer of the package entry load the compiled CST grammar tables:
 * Node's ESM loader does not tree-shake, so an unused named import still
 * executes the module it is taken from, and each table is multiple megabytes.
 */

/* The CSS grammar labels its document trivia arms `whitespace` and
 * `blockComment`; only the comment arm needs a root entry. */
export const commentTriviaLabels = ['blockComment'] as const;
