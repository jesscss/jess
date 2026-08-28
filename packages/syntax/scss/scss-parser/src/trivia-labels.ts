/**
 * Root-trivia label selection for the SCSS grammar.
 *
 * This is a plain fact about the grammar's trivia arm labels, so it lives in a
 * leaf module with no imports. Reading it from the CST entry instead would make
 * every consumer of the package entry load the compiled CST grammar tables:
 * Node's ESM loader does not tree-shake, so an unused named import still
 * executes the module it is taken from, and each table is multiple megabytes.
 */

/* The SCSS grammar labels its trivia arms `whitespace` and `comment`: a
 * statement-level block comment is a `Comment` node rather than trivia, so the
 * comment category covers document line comments and the block comments the
 * custom-value scope strips out of the value. */
export const commentTriviaLabels = ['comment'] as const;
