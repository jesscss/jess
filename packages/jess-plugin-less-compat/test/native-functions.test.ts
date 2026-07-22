import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Context } from '@jesscss/core';
import { defineFunction, makeDimension } from '@jesscss/core/value';
import { LessCompatPlugin } from '../src/plugin.js';

describe('AST-v2 native function boundary', () => {
  it('contributes typed Fn values directly to the Context plugin host', () => {
    const double = defineFunction('double', {
      variadic: true,
      params: [],
      body: () => makeDimension(2)
    });
    const context = new Context({}, []);
    new LessCompatPlugin({ functions: [double] }).setContext(context);
    expect(context.pluginHost?.globalFns).toEqual([double]);
  });

  it('contains no legacy node conversion or function-registry bridge', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/plugin.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from '\.\/transform|LessAdapterBase|JsFunction/);
    expect(source).not.toContain('toLessNode(');
    expect(source).not.toContain('fromLessPluginReturnValue(');
  });
});
