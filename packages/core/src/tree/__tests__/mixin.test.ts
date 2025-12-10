import { mixin, rules, el, decl, any, condition, expr, ref, list, vardecl, Node, call, ruleset, rest } from '..';
import { Context } from '../../context';

let context: Context;

describe('Mixin', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });
  afterAll(() => {
    Node.prototype.fullRender = false;
  });
  beforeEach(() => {
    context = new Context();
    context.depth = 2;
  });

  describe('calling', () => {
    it('should call a simple mixin', async () => {
      // Create a mixin definition: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      // Create root rules containing both
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test');
      expect(css).toContain('color: red');
    });

    it('should call a ruleset as a mixin (no parens)', async () => {
      // Create a ruleset that can be used as a mixin: .my-mixin { color: red; }
      const mixinRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) }) // Use 'mixin-ruleset' to find both Mixins and Rulesets
        ])
      });

      // Create root rules containing both
      const root = rules([mixinRuleset, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test');
      expect(css).toContain('color: red');
    });

    it('should call a mixin with parameters', async () => {
      // Create a mixin with a parameter: .my-mixin(@color) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }) // Parameter without default is Any with role: 'property' (like variable names)
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      // Create root rules containing both
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test');
      expect(css).toContain('color: blue');
    });

    it('should call a mixin with default parameter values', async () => {
      // Create a mixin with a default parameter: .my-mixin(@color: red) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          vardecl({ name: 'color', value: any('red') }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      // Create a ruleset that calls the mixin with args: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset1, testRuleset2]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test1');
      expect(css).toContain('.test2');
      expect(css).toContain('color: red'); // Default value
      expect(css).toContain('color: blue'); // Overridden value
    });

    it('should call a mixin with multiple parameters', async () => {
      // Create a mixin with multiple parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue, 16px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue'), any('16px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test');
      expect(css).toContain('color: blue');
      expect(css).toContain('font-size: 16px');
    });

    it('should call a mixin with @arguments', async () => {
      // Create a mixin that uses @arguments: .my-mixin(@a, @b) { margin: @arguments; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test');
      // @arguments should contain the list of arguments
      expect(css).toContain('margin');
    });

    it('should call a mixin with a guard condition', async () => {
      // Create a mixin with a guard: .my-mixin(@color) when (@color = red) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          expr(ref({ key: 'color' }, { type: 'variable' })),
          '=',
          expr(any('red'))
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with matching condition: .test1 { .my-mixin(red); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      });

      // Create a ruleset that calls the mixin with non-matching condition: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset1, testRuleset2]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test1');
      expect(css).toContain('color: red'); // Should match and output
      // .test2 should not have color since the guard doesn't match
      expect(css).toContain('.test2');
    });

    it('should call a mixin that calls another mixin', async () => {
      // Create a base mixin: .base-mixin(@color) { color: @color; }
      const baseMixin = mixin({
        name: any('.base-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a mixin that calls the base mixin: .wrapper-mixin(@color) { .base-mixin(@color); }
      const wrapperMixin = mixin({
        name: any('.wrapper-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          call({
            name: ref({ key: '.base-mixin' }, { type: 'mixin' }),
            args: list([ref({ key: 'color' }, { type: 'variable' })])
          })
        ])
      });

      // Create a ruleset that calls the wrapper mixin: .test { .wrapper-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.wrapper-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([baseMixin, wrapperMixin, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.test');
      expect(css).toContain('color: blue');
    });
  });

  describe('serialization', () => {
    it('should serialize a mixin', () => {
      const rule = mixin({
        name: any('myMixin'),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
      });
      expect(`${rule}`).toBeString(`
        myMixin() {
          color: black;
          background-color: white;
        }
      `);
    });

    it('should serialize a mixin with args', () => {
      const rule = mixin({
        name: any('my-mixin'),
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
      });
      expect(`${rule}`).toBeString(`
        my-mixin($a: black; $b: white) {
          color: black;
          background-color: white;
        }
      `);
    });

    it('should serialize a guard', () => {
      const rule = mixin({
        name: any('my-mixin'),
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        guard: condition([expr(ref({ key: 'a' })), '=', expr(ref({ key: 'b' }))]),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
      });
      expect(`${rule}`).toBeString(`
        my-mixin($a: black; $b: white) when ($a = $b) {
          color: black;
          background-color: white;
        }
      `);
    });
  });

  // it('should serialize to a module', () => {
  //   let rule = mixin({
  //     name: ident('myMixin'),
  //     value: ruleset([
  //       decl({ name: 'color', value: any('black') }),
  //       decl({ name: 'background-color', value: any('white') })
  //     ])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     'let myMixin = function() { return $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("color"),\n      value: $J.any("black")\n    }))\n    $OUT.push($J.decl({\n      name: $J.any("background-color"),\n      value: $J.any("white")\n    }))\n    return $OUT\n  })()\n)}'
  //   )
  //   expect(rule.value.obj()).toEqual({
  //     color: 'black',
  //     'background-color': 'white'
  //   })
  // })
});