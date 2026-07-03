import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

/**
 * Combinators are string leaves (' ', '>', '+', '~', '|', '||') inside a
 * ComplexSelector/RelativeSelector value array. These helpers treat a combinator
 * uniformly whether it is a bare string or (transitionally) a Combinator node, so
 * consumers never branch on the representation.
 */
export function isStringCombinator(value: string): boolean {
  return value === ' ' || value === '>' || value === '+' || value === '~' || value === '|' || value === '||';
}

/** Whether a selector-array component is a combinator (string or node). */
export function isCombinator(component: unknown): boolean {
  return typeof component === 'string'
    ? isStringCombinator(component)
    : component != null && isNode(component as Node, N.Combinator);
}

/** The combinator's string value (' ', '>', ...) from a string or node combinator. */
export function combinatorValue(component: string | { value: string }): string {
  return typeof component === 'string' ? component : component.value;
}
