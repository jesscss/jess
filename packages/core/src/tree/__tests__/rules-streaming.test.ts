import { describe, expect, it } from 'vitest';
import { Node, any, decl, rules } from '../index.js';
import { Context } from '../../context.js';
import { getPrintOptions, OutputWriter, type PrintOptions } from '../util/print.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  previews = 0;
  wholeBufferReads = 0;

  override getSince(mark: number): string {
    if (mark === 0) {
      this.wholeBufferReads++;
    }
    return super.getSince(mark);
  }

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override preview(fn: () => string | void, preserveSegments?: boolean): string;
  override preview(fn: () => Promise<string | void>, preserveSegments?: boolean): Promise<string>;
  override preview(fn: () => string | Promise<string | void> | void, preserveSegments?: boolean): string | Promise<string> {
    this.previews++;
    return super.preview(fn, preserveSegments);
  }
}

class DirectRule extends Node<string> {
  override toString(options?: PrintOptions): string {
    return this.toTrimmedString(options);
  }

  override toTrimmedString(options?: PrintOptions): string {
    const w = getPrintOptions(options).writer!;
    w.add(this.value);
    return this.value;
  }
}

describe('Rules streaming', () => {
  it('streams plain rule children without capture scaffolding', () => {
    const context = new Context();
    const writer = new CountingWriter();
    const node = rules([
      decl({ name: 'color', value: any('red') }),
      decl({ name: 'background', value: any('blue') })
    ]);

    expect(node.toString({ context, writer })).toBe('color: red;\nbackground: blue;\n');
    expect(writer.captures).toBe(0);
    expect(writer.previews).toBe(0);
  });

  it('streams nested rule wrappers without capture scaffolding', () => {
    const context = new Context();
    const writer = new CountingWriter();
    const node = rules([
      rules([
        decl({ name: 'color', value: any('red') })
      ]),
      decl({ name: 'background', value: any('blue') })
    ]);

    expect(node.toString({ context, writer })).toBe('color: red;\nbackground: blue;\n');
    expect(writer.captures).toBe(0);
    expect(writer.previews).toBe(0);
  });

  it('does not inspect root output for each emitted child boundary', () => {
    const writer = new CountingWriter();
    const declarations = Array.from({ length: 12 }, (_, index) => (
      new DirectRule(`p${index}: ${index};`)
    ));
    const node = rules(declarations);

    expect(node.toString({ writer })).toContain('p11: 11;');
    expect(writer.wholeBufferReads).toBe(1);
  });
});
