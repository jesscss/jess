/**
 * Source-private, recognition-only terminals used by the direct CSS AST grammar.
 *
 * This is deliberately neither a public grammar export nor a construction
 * layer. `composeLeaf()` macro-fuses these terminals into the AST grammar; its
 * reductions remain local and call core constructors directly.
 */
import { regex, rules } from 'parseman' with { type: 'macro' };

const propertyName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const keywordValue = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);

export const cssAstSyntax = rules(g => ({
  CssAstSyntaxProperty: propertyName,
  CssAstSyntaxKeyword: keywordValue
}));
