import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  interpolated,
  list,
  quoted,
  ref,
  rules,
  type Rules as RulesClass,
  vardecl
} from '../index.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('Interpolated', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders interpolated source syntax through toTrimmedString()', () => {
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });

    expect(node.toTrimmedString()).toBe('hello-$name');
  });

  it('streams interpolated source syntax without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [
        ref({ key: 'name' }, { type: 'variable' }),
        list([any('one'), any('two')])
      ]
    });

    expect(node.toTrimmedString({ writer })).toBe('hello-$name-one, two');
    expect(writer.toString()).toBe('hello-$name-one, two');
    expect(writer.captures).toBe(0);
  });

  it('renders resolved interpolated values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const rendered = interpolatedNode.render(context);

    expect(rendered).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.preEvaluated).toBe(false);
  });

  it('writes resolved interpolated output into flat buffers', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const buffer = createRenderBuffer('flat');
    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });

    expect(await interpolatedNode.render(context, buffer)).toBe('hello-world');
    expect(buffer.parts).toEqual(['hello-world']);
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.preEvaluated).toBe(false);
  });

  it('resolves interpolated values without touching render state', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const resolved = await interpolatedNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source interpolated child containers canonical after resolve(context)', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [list([
        any('one'),
        ref({ key: 'name' }, { type: 'variable' })
      ])]
    });
    const resolved = await interpolatedNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('hello-one, world');
    expect(interpolatedNode.toTrimmedString()).toBe('hello-one, $name');
  });

  it('preserves quoted replacement syntax when requested', () => {
    const node = interpolated({
      source: `progid:test(value=${INTERPOLATION_PLACEHOLDER})`,
      replacements: [quoted('#000000', { quote: '"' })]
    }, { preserveQuotedSyntax: true });

    expect(node.toTrimmedString()).toBe('progid:test(value="#000000")');
  });
});
