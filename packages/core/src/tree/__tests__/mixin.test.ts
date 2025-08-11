import { mixin, rules, el, decl, any, condition, expr, ref, list, vardecl } from '..';
import { Context } from '../../context';

let context: Context;

describe('Mixin', () => {
  beforeEach(() => {
    context = new Context();
    context.depth = 2;
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