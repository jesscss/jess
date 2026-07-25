import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Context } from '@jesscss/core';
import { defineFunction, emitValue, makeDimension, type FnCtx, type ValueObj } from '@jesscss/core/value';
import { LessApiBridge } from '../src/less-api-bridge.js';
import { LessCompatPlugin } from '../src/plugin.js';

const fnCtx: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: emitValue
};

function hasNativeValue(value: unknown): value is { readonly value: readonly unknown[] } {
  return typeof value === 'object' && value !== null && 'value' in value && Array.isArray(value.value);
}

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

  it('keeps the compat plugin entrypoint free of the archived visitor adapter', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/plugin.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from '\.\/transform|LessAdapterBase|JsFunction/);
    expect(source).not.toContain('toLessNode(');
    expect(source).not.toContain('fromLessPluginReturnValue(');
  });

  it('adapts Less plugin installs through the shared bridge', async () => {
    const bridge = new LessApiBridge([{
      install(less, _manager, functions) {
        functions.add('increment', value => new less.tree.Dimension(Number(value?.valueOf?.() ?? value) + 1));
      }
    }]);
    expect(bridge.globalFns).toHaveLength(1);
    const result = await bridge.invokeRawFunction(bridge.globalFns[0]!, [makeDimension(4)], fnCtx);
    expect(result).toEqual(makeDimension(5));
  });

  it('does not materialize unused child value wrappers for raw sequence args', async () => {
    let bytesReads = 0;
    const child: ValueObj = {
      type: 'Keyword',
      text: 'child',
      get bytes() {
        bytesReads++;
        return 'child';
      }
    };
    const bridge = new LessApiBridge();
    const fn = bridge.addFunction('probe', () => {
      expect(bytesReads).toBe(0);
      return 'ok';
    });
    const result = await bridge.invokeRawFunction(fn, [[child]], fnCtx);
    expect(emitValue(result!)).toBe('ok');
    expect(bytesReads).toBe(0);
  });

  it('caches lazy child wrappers when a Less plugin reads a sequence arg repeatedly', async () => {
    const child: ValueObj = { type: 'Keyword', text: 'child', bytes: 'child' };
    const bridge = new LessApiBridge();
    const fn = bridge.addFunction('probe', (arg) => {
      expect(hasNativeValue(arg)).toBe(true);
      if (!hasNativeValue(arg)) {
        return 'bad';
      }
      const first = arg.value;
      const second = arg.value;
      expect(first).toBe(second);
      expect(first[0]).toBe(second[0]);
      return 'ok';
    });
    const result = await bridge.invokeRawFunction(fn, [[child]], fnCtx);
    expect(emitValue(result!)).toBe('ok');
  });
});
