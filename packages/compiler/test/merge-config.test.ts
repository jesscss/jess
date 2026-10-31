import { describe, expect, it } from 'vitest';
import type { ConfigOptions } from '../src/index.js';
import { mergeConfig } from '../src/merge-config.js';

class FakePlugin {
  name = 'fake';
  supportedExtensions = ['.fake'];
}

const base = (): ConfigOptions => ({ compile: {}, output: {}, language: {} });

describe('mergeConfig', () => {
  it('concatenates plugin and search-path lists, keeping plugin instances by reference', () => {
    const first = new FakePlugin();
    const second = new FakePlugin();
    const merged = mergeConfig(
      base(),
      { compile: { plugins: [first, '@jesscss/plugin-js'], searchPaths: ['a'] } },
      { compile: { plugins: [second], searchPaths: ['b'] } }
    );
    expect(merged.compile).toEqual({ plugins: [first, '@jesscss/plugin-js', second], searchPaths: ['a', 'b'] });
    expect(merged.compile?.plugins?.[0]).toBe(first);
    expect(merged.compile?.plugins?.[2]).toBe(second);
  });

  it('copies a list onto an unset key, so later merges never write into the source', () => {
    const plugin = new FakePlugin();
    const options = { compile: { plugins: [plugin], searchPaths: ['a'] } };
    const merged = mergeConfig(base(), options);
    mergeConfig(merged, { compile: { searchPaths: ['b'] } });
    expect(merged.compile?.plugins).not.toBe(options.compile.plugins);
    expect(merged.compile?.plugins?.[0]).toBe(plugin);
    expect(options.compile.searchPaths).toEqual(['a']);
  });

  it('deep-merges nested option objects field by field without aliasing the source', () => {
    const fileConfig = { language: { less: { mathMode: 'parens-division', globalVars: { a: '1' } } } };
    const merged = mergeConfig(
      base(),
      fileConfig,
      { language: { less: { unitMode: 'strict', globalVars: { b: '2' } } } }
    );
    expect(merged.language).toEqual({
      less: { mathMode: 'parens-division', unitMode: 'strict', globalVars: { a: '1', b: '2' } }
    });
    expect(merged.language?.less).not.toBe(fileConfig.language.less);
    expect(fileConfig.language.less.globalVars).toEqual({ a: '1' });
  });

  it('never lets an undefined value replace a set one, but lets null replace it', () => {
    const merged = mergeConfig(
      base(),
      { compile: { mathMode: 'always' }, language: { less: { globalVars: { a: '1' } } } },
      { compile: { mathMode: undefined }, language: { less: { globalVars: null } } },
      undefined
    );
    expect(merged.compile).toEqual({ mathMode: 'always' });
    expect(merged.language).toEqual({ less: { globalVars: null } });
  });

  it('creates a key for an undefined value only when the key is missing', () => {
    const merged = mergeConfig(base(), { outputFile: undefined });
    expect('outputFile' in merged).toBe(true);
    expect(merged).toEqual({ compile: {}, output: {}, language: {}, outputFile: undefined });
  });

  it('joins an output object to an output list as a later entry, dropping empty objects', () => {
    const list = [{ file: '{name}.css' }, { file: '{name}.min.css', compress: true }];
    expect(mergeConfig(base(), { output: list }).output).toEqual(list);
    expect(mergeConfig(base(), { output: list }, { output: { collapseNesting: 'native' } }).output)
      .toEqual([...list, { collapseNesting: 'native' }]);
    expect(mergeConfig(base(), { output: { compress: true } }, { output: list }).output)
      .toEqual([{ compress: true }, ...list]);
  });

  it('merges output objects field by field', () => {
    expect(mergeConfig(base(), { output: { compress: true } }, { output: { sourceMap: { sourceMapURL: 'x' } } }).output)
      .toEqual({ compress: true, sourceMap: { sourceMapURL: 'x' } });
  });

  it('assigns functions and other non-plain objects by reference', () => {
    const fn = () => 'x';
    const pattern = /a/u;
    const merged = mergeConfig(base(), { compile: { hook: fn, pattern } });
    expect((merged.compile as Record<string, unknown> | undefined)?.hook).toBe(fn);
    expect((merged.compile as Record<string, unknown> | undefined)?.pattern).toBe(pattern);
  });

  it('keeps a null-prototype object plain, and skips __proto__', () => {
    const nested: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    nested.a = 1;
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "language": {}}') as object;
    const merged = mergeConfig(base(), { language: { less: nested } }, hostile);
    expect(Object.getPrototypeOf(merged.language?.less)).toBeNull();
    expect(merged.language?.less).not.toBe(nested);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  it('returns the target it merged into', () => {
    const target = base();
    expect(mergeConfig(target, { compile: { strict: true } })).toBe(target);
  });
});
