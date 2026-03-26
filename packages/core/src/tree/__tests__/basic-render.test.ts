import { describe, it, expect, beforeEach } from 'vitest';
import { rules, ruleset, decl, sel, el, spaced, any, comment, coll, dimension } from '../index.js';
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
    const css = evald.render(context);

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
    const css = evald.render(context);

    expect(css).toBeString(`
      .test {
        color/* survive */ /* me too */: red;
      }`
    );
  });

  it('should expand Collection-valued declarations into dashed properties', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]) as any,
        rules: rules([
          decl({
            name: 'font',
            value: coll([
              decl({ name: 'size', value: dimension([1, 'rem']) }),
              decl({ name: 'weight', value: any('bold') })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.render(context);

    expect(css).toBeString(`
      .test {
        font-size: 1rem;
        font-weight: bold;
      }`
    );
  });

  it('should keep the base shorthand and expand nested property declarations', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]) as any,
        rules: rules([
          decl({
            name: 'margin',
            value: spaced([
              any('auto'),
              coll([
                decl({ name: 'left', value: dimension([1, 'px']) }),
                decl({ name: 'right', value: dimension([2, 'px']) })
              ])
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.render(context);

    expect(css).toBeString(`
      .test {
        margin: auto;
        margin-left: 1px;
        margin-right: 2px;
      }`
    );
  });

  it('should recursively expand deep nested property declarations', async () => {
    const node = rules([
      ruleset({
        selector: sel([el('.test')]) as any,
        rules: rules([
          decl({
            name: 'border',
            value: coll([
              decl({
                name: 'color',
                value: coll([
                  decl({ name: 'base', value: any('red') }),
                  decl({ name: 'hover', value: any('blue') })
                ])
              })
            ])
          })
        ])
      })
    ]);

    const evald = await node.eval(context);
    const css = evald.render(context);

    expect(css).toBeString(`
      .test {
        border-color-base: red;
        border-color-hover: blue;
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
    const css = evald.render(context);

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
