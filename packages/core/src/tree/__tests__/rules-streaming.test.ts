import { describe, expect, it } from 'vitest';
import { any, decl, rules } from '../index.js';
import { Context } from '../../context.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
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
  });
});
