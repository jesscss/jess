import { describe, it, expect, beforeEach } from 'vitest';
import { rules, ruleset, decl, sel, el, spaced } from '../index.js';
import { Context } from '../../context.js';

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

    const evald = await node.eval(context);
    const css = evald.toString();

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

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: false });

    expect(css).toBeString(`
      .test {
        color: red;
      }`
    );
  });
});

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

    const evald = await node.eval(context);
    const css = evald.toString();

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

    const evald = await node.eval(context);
    const css = evald.toString({ collapseNesting: false });

    expect(css).toBeString(`
      .test {
        color: red;
      }`
    );
  });
});
