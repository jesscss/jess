import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, decl, rawrules } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

describe('RawRules', () => {
  it('serializes raw rules children without parent formatting', () => {
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);

    expect(node.toBraced()).toBe('{color: red}');
  });

  it('resolves raw rules as source-owned containers without eval stamping', () => {
    const context = new Context();
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes raw child output into render buffers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(node.render(context, buffer)).toBe('color: red');
    expect(buffer.segments).toEqual(['color: red']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders raw child output directly without public resolve', () => {
    const context = new Context();
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);
    node.resolve = () => {
      throw new Error('RawRules direct render should serialize source syntax');
    };

    expect(node.render(context)).toBe('color: red');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('writes raw children without public toString transport when trivia is inactive', () => {
    const name = any('color');
    const value = any('red');
    let stringCalls = 0;
    name.toString = value.toString = () => {
      stringCalls++;
      return '';
    };

    const node = rawrules([
      decl({ name, value })
    ]);

    expect(node.toBraced()).toBe('{color: red}');
    expect(node.toTrimmedString()).toBe('color: red');
    expect(stringCalls).toBe(0);
  });

  it('writes empty raw rules without writer readback', () => {
    const writer = new CountingWriter();
    const bracedWriter = new CountingWriter();
    const node = rawrules([]);

    expect(node.toTrimmedString({ writer })).toBe('');
    expect(writer.toString()).toBe('');
    expect(writer.reads).toBe(0);
    expect(node.toBraced({ writer: bracedWriter })).toBe('{}');
    expect(bracedWriter.toString()).toBe('{}');
    expect(bracedWriter.reads).toBe(0);
  });
});
