import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rules, ruleset, decl, sel, el, spaced } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { F_STATIC } from '../node.js';

describe('Basic Ruleset Rendering', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('should render a basic ruleset correctly', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) })
        ])
      })
    ]);

    const css = await renderNodeToString(node, context);

    expect(css).toBeString(`
      .test {
        color: red;
      }`
    );
  });

  it('should render a basic ruleset without collapseNesting', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) })
        ])
      })
    ]);

    const css = await renderNodeToString(node, context, { collapseNesting: false });

    expect(css).toBeString(`
      .test {
        color: red;
      }`
    );
  });

  it('renders a root rules container through render(context)', () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) })
        ])
      })
    ]);

    expect(node.render(context)).toBeString(`
      .test {
        color: red;
      }
    `);
  });

  it('renders plain static root rules without deriving an eval surface', () => {
    const node = rules([
      decl({ name: 'color', value: spaced([el('red')]) })
    ]);
    const deriveSpy = vi.spyOn(node, 'derive');
    const evalSpy = vi.spyOn(node, 'eval');

    expect(node.hasFlag(F_STATIC)).toBe(true);
    expect(node.render(context)).toBeString(`
      color: red;
    `);
    expect(deriveSpy).not.toHaveBeenCalled();
    expect(evalSpy).not.toHaveBeenCalled();
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(node.value[0]!.parent).toBe(node);
  });

  it('keeps static fragment string and buffer render separators without deriving', () => {
    const node = rules([
      decl({ name: 'color', value: spaced([el('red')]) }),
      decl({ name: 'background', value: spaced([el('blue')]) })
    ]);
    const deriveSpy = vi.spyOn(node, 'derive');
    const buffer = createRenderBuffer('flat');

    expect(node.hasFlag(F_STATIC)).toBe(true);
    expect(node.render(context)).toBeString(`
      color: red;
      background: blue;`
    );
    expect(node.render(context, buffer)).toBeString(`
      color: red;
      background: blue;
    `);
    expect(buffer.parts.join('')).toBeString(`
      color: red;
      background: blue;
    `);
    expect(deriveSpy).not.toHaveBeenCalled();
  });

  it('resolves a root rules container without touching render state', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]),
        rules: rules([
          decl({ name: 'color', value: spaced([el('red')]) })
        ])
      })
    ]);

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      .test {
        color: red;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
