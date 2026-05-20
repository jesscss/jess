import { describe, it, expect, beforeEach } from 'vitest';
import { rules, ruleset, decl, sel, el, spaced } from '../index.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';

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
