import { mixin, rules, el, decl, any, ref, Node, call, ruleset } from '..';
import { Context } from '../../context';
import { JessError } from '../../jess-error';

let context: Context;

describe('Mixin Recursion Detection', () => {
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

  describe('recursive mixin calls that should fail', () => {
    it('should fail when calling .foo.bar() from within .foo .bar (would cause recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo.bar();
      //     color: red;
      //   }
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo.bar' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset]);
      context.root = root;

      await expect(root.eval(context)).rejects.toThrow(ReferenceError);
      await expect(root.eval(context)).rejects.toThrow(/not defined|No matching definition/);
    });

    it('should fail when calling .foo() from within .foo .bar (would cause recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo();
      //     color: red;
      //   }
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset]);
      context.root = root;

      await expect(root.eval(context)).rejects.toThrow(ReferenceError);
      await expect(root.eval(context)).rejects.toThrow(/not defined|No matching definition/);
    });

    it('should fail when calling .clearfix() from within .clearfix (direct self-reference)', async () => {
      // .clearfix {
      //   .clearfix();
      // }
      const clearfixRuleset = ruleset({
        selector: el('.clearfix'),
        rules: rules([
          call({ name: ref({ key: '.clearfix' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const root = rules([clearfixRuleset]);
      context.root = root;

      await expect(root.eval(context)).rejects.toThrow(ReferenceError);
      await expect(root.eval(context)).rejects.toThrow(/not defined|No matching definition/);
    });

    it('should fail when duplicate .foo .bar blocks both call .foo.bar() (would cause mutual recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo.bar();
      //     color: red;
      //   }
      // }
      // .foo {
      //   .bar {
      //     .foo.bar();
      //     color: red;
      //   }
      // }
      const fooRuleset1 = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo.bar' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const fooRuleset2 = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo.bar' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset1, fooRuleset2]);
      context.root = root;

      await expect(root.eval(context)).rejects.toThrow(ReferenceError);
      await expect(root.eval(context)).rejects.toThrow(/not defined|No matching definition/);
    });

    it('should fail when mixin A calls mixin B, and mixin B would call mixin A (mutual recursion)', async () => {
      // .a {
      //   .b();
      // }
      // .b {
      //   .a();
      // }
      const aRuleset = ruleset({
        selector: el('.a'),
        rules: rules([
          call({ name: ref({ key: '.b' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const bRuleset = ruleset({
        selector: el('.b'),
        rules: rules([
          call({ name: ref({ key: '.a' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const root = rules([aRuleset, bRuleset]);
      context.root = root;

      // When .a is called, it calls .b, which would call .a again - should fail
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.a' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const rootWithCall = rules([aRuleset, bRuleset, testRuleset]);
      context.root = rootWithCall;

      await expect(rootWithCall.eval(context)).rejects.toThrow(ReferenceError);
      await expect(rootWithCall.eval(context)).rejects.toThrow(/not defined|No matching definition/);
    });
  });

  describe('non-recursive mixin calls that should succeed', () => {
    it('should succeed when calling .foo.foo() from within .foo .bar if .foo .foo exists (no recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo.foo();
      //     color: red;
      //   }
      //   .foo {
      //     color: blue;
      //   }
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo.foo' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.foo'),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.foo .bar');
      expect(css).toContain('color: red');
      expect(css).toContain('.foo .foo');
      expect(css).toContain('color: blue');
    });

    it('should succeed when calling a mixin from a different ruleset (no recursion)', async () => {
      // .foo {
      //   .bar();
      // }
      // .bar {
      //   color: blue;
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          call({ name: ref({ key: '.bar' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const barRuleset = ruleset({
        selector: el('.bar'),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });

      const root = rules([fooRuleset, barRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.foo');
      expect(css).toContain('color: blue');
    });
  });
});
