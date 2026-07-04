/**
 * Functional Jess grammar — `jessGrammar = compose([scssGrammar, <Jess delta>])`.
 * The delta is currently EMPTY: the composed CSS → Less → SCSS grammar round-trips
 * basic Jess until control-flow / mixin syntax is ported to typed AST nodes.
 * Jess-specific rules slot into the inline delta below (structural `node()`s
 * building via the injected `ctx.build` host). The host + parse entry live in
 * ./functional-parser.ts; the shared driver in @jesscss/css-parser.
 */
import { rules, compose } from 'parseman' with { type: 'macro' };
import { scssGrammar } from '@jesscss/scss-parser';

export const jessGrammar = compose([scssGrammar, rules((_g: any) => ({}))]);
