import { describe, expect, it } from 'vitest';
import {
  isGuardNodeOf,
  isParam,
  isValueSlotOf,
  requireGuardNodeOf,
  requireToken
} from '../css-grammar-helpers.js';
import { dimension, keyword } from '../nodes.js';
import type { Keyword, ValueNode } from '../nodes.js';

/* A deliberately narrow operand set, so the tests can see the predicate is the caller's. */
const isKeywordOperand = (value: unknown): value is Keyword =>
  typeof value === 'object' && value !== null && 'type' in value && value.type === 'Keyword';
const isOperand = (value: unknown): value is ValueNode => isKeywordOperand(value);

describe('shared dialect grammar helpers', () => {
  it('names the calling dialect in the error, exactly as the dialect copies did', () => {
    expect(() => requireToken(42, 'SCSS')).toThrow(new TypeError('SCSS grammar produced a non-token child.'));
    expect(() => requireToken(42, 'Jess')).toThrow(new TypeError('Jess grammar produced a non-token child.'));
    expect(() => requireGuardNodeOf({ g: 'nope' }, isOperand, 'Jess')).toThrow(new TypeError('Jess grammar produced a non-guard child.'));
  });

  it('checks guard operands and value-slot leaves with the caller\'s value predicate', () => {
    const truth = { g: 'truth', value: keyword('a'), parens: 0 };
    expect(isGuardNodeOf({ g: 'not', inner: truth, parens: 0 }, isOperand)).toBe(true);
    expect(isGuardNodeOf({ g: 'truth', value: dimension(1, 'px'), parens: 0 }, isOperand)).toBe(false);

    /* The written-as-authored facts (ledger J20) are part of every guard's shape. */
    expect(isGuardNodeOf({ g: 'not', inner: { g: 'truth', value: keyword('a') }, parens: 0 }, isOperand)).toBe(false);
    expect(isGuardNodeOf({ g: 'cmp', op: '=', left: keyword('a'), right: keyword('b'), parens: 0 }, isOperand)).toBe(false);
    expect(isValueSlotOf([keyword('a'), [keyword('b')]], isOperand)).toBe(true);
    expect(isValueSlotOf([keyword('a'), [dimension(1, 'px')]], isOperand)).toBe(false);
  });

  it('tells a reduced parameter apart from tokens and AST nodes', () => {
    expect(isParam({ name: 'x' })).toBe(true);
    expect(isParam({ rest: true })).toBe(true);
    expect(isParam({ value: '(' })).toBe(false);
    expect(isParam(keyword('x'))).toBe(false);
  });
});
