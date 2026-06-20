import { describe, expect, test } from 'vitest';
import {
  isScannerNativeRawComplexExtendTargetSelector,
  isScannerNativeRawExtendTargetSelector,
  isScannerNativeRawSelector,
  isScannerNativeRawSelectorBranch,
  isScannerNativeRawSimpleSelector,
  readScannerNativeNestedAmpersandPseudoSelector
} from '../raw-selector.js';

describe('scanner-native raw selector classifier', () => {
  test('admits the cheap raw selector subset without materialization output', () => {
    for (const selector of [
      '*',
      'div',
      '#id',
      '.class',
      ':root',
      ':hover',
      '[data-kind]',
      '[data-kind="primary"]',
      '[data-label="hello world"]',
      '[data-label="hello, world"]',
      'button.primary',
      'button:hover',
      '.a::before',
      'button[data-kind="primary"].active',
      'button:hover.active',
      '.a.b#c',
      '.a > .b',
      '.a:hover > button.primary',
      '.a[data-kind] > button.primary',
      '.a[data-label="hello world"] > button.primary',
      '.a + button.primary',
      '.a ~ #id',
      '.a .b',
      '.a, button:hover',
      '.a, button[data-kind]',
      '.a, button[data-label="hello, world"]'
    ]) {
      expect(isScannerNativeRawSelector(selector), selector).toBe(true);
    }
  });

  test('keeps richer selectors outside the scanner-native subset', () => {
    for (const selector of [
      ':is(.a)',
      ':hover(1)',
      ':-',
      '::-',
      '[data kind]',
      '[data=123]',
      '[data=-1]',
      'button[data=123]',
      '[data-kind="unterminated]',
      '@{selector}',
      '.a\n.b',
      '.a,'
    ]) {
      expect(isScannerNativeRawSelector(selector), selector).toBe(false);
    }
  });

  test('requires explicit admission for nested ampersand pseudo selectors', () => {
    expect(isScannerNativeRawSelector('&:focus')).toBe(false);
    expect(isScannerNativeRawSelector('&::before')).toBe(false);
    expect(isScannerNativeRawSelector('&:focus', true)).toBe(true);
    expect(isScannerNativeRawSelector('&::before', true)).toBe(true);
    expect(readScannerNativeNestedAmpersandPseudoSelector('&:focus')).toBe(':focus');
    expect(readScannerNativeNestedAmpersandPseudoSelector('&::before')).toBe('::before');
  });

  test('keeps extend targets stricter than ordinary selector branches', () => {
    expect(isScannerNativeRawSelectorBranch('button.primary')).toBe(true);
    expect(isScannerNativeRawSimpleSelector('button')).toBe(true);
    expect(isScannerNativeRawExtendTargetSelector('button')).toBe(false);
    expect(isScannerNativeRawExtendTargetSelector('.button')).toBe(true);
    expect(isScannerNativeRawComplexExtendTargetSelector('.button > #icon')).toBe(true);
    expect(isScannerNativeRawComplexExtendTargetSelector('button > .icon')).toBe(false);
  });
});
