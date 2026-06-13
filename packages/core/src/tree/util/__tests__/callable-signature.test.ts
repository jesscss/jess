import { describe, expect, it } from 'vitest';
import { any } from '../../index.js';
import { getCallableNodeSignature, getCallableRestSignature, getCallableSignatureKey } from '../callable-signature.js';

describe('callable signature helpers', () => {
  it('builds stable node and rest signatures without rules closure state', () => {
    const first = any('1px');
    const second = any('solid');

    expect(getCallableNodeSignature(first)).toBe('1px');
    expect(getCallableRestSignature([first, second], '@rest', false)).toBe('1px solid');
    expect(getCallableRestSignature([first, second], '@rest', false, 1)).toBe('solid');
    expect(getCallableRestSignature([], '@rest', false)).toBe('@rest');
    expect(getCallableRestSignature([], '@rest', true)).toBe('');
    expect(getCallableSignatureKey(['1px', undefined, 'solid'])).toBe('1px;solid');
    expect(getCallableSignatureKey([undefined])).toBeUndefined();
  });
});
