/**
 * Source-private CSS recognition terminals for direct AST grammars.
 *
 * Consumers macro-fuse this compiled artifact with their local reductions. It
 * contains recognition only: no AST construction or runtime composition seam.
 */
import { regex, rules } from 'parseman' with { type: 'macro' };

const propertyName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const keywordValue = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const doubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const singleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const urlOpen = regex(/url\(/i);
const urlInner = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

export const cssAstSyntax = rules(g => ({
  CssAstSyntaxProperty: propertyName,
  CssAstSyntaxKeyword: keywordValue,
  CssAstSyntaxDoubleQuotedText: doubleQuotedText,
  CssAstSyntaxSingleQuotedText: singleQuotedText,
  CssAstSyntaxUrlOpen: urlOpen,
  CssAstSyntaxUrlInner: urlInner
}));
