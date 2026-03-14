import { describe, it, expect, beforeEach } from 'vitest';
import { rules, ruleset, decl, sel, el, spaced, any, comment } from '../index.js';
import { Context } from '../../context.js';

describe('Basic Ruleset Rendering', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('should render a basic ruleset correctly', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]) as any,
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
        selector: sel([el('.test')]) as any,
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

  it('should preserve comments attached to declaration names', async () => {
    const property = any('color', { role: 'property' });
    property.post = [comment('/* survive */'), ' ', comment('/* me too */')];

    const node = rules([
      ruleset({
        selector: sel([el('.test')]) as any,
        rules: rules([
          decl({ name: property, value: spaced([el('red')]) })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.toString();

    expect(css).toBeString(`
      .test {
        color/* survive */ /* me too */: red;
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
        selector: sel([el('.test')]) as any,
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
        selector: sel([el('.test')]) as any,
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
