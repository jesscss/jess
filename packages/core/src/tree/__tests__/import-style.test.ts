import { style, rules, sel, el, ref, any, ruleset, mixin, decl, call } from '..';
import { Context } from '../../context';

let context: Context;

describe('Include', () => {
  beforeEach(() => {
    context = new Context();
  });
  it('should include a mixin', async () => {
    let node = rules([
      mixin({
        selector: el('foo'),
        rules: rules([
          decl({ name: 'prop1', value: any('value') })
        ])
      }),
      mixin({
        selector: el('foo'),
        rules: rules([
          decl({ name: 'prop2', value: any('value') })
        ])
      }),
      style(call({
        ref: ref('foo', { type: 'mixin' })
      }))
    ]);
    let evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      prop1: value;
      prop2: value;
    `);
  });
  // it('should be able to include an object', () => {
  //   let obj = {
  //     width: '50px',
  //     height: '25px'
  //   }

  //   let node = rule({
  //     selector: el('.rule'),
  //     value: [
  //       include(obj)
  //     ]
  //   })
  //   let result = node.eval(context)
  //   expect(`${result}`).toBe('.rule {\n  width: 50px;\n  height: 25px;\n}')
  // })

  // it('should serialize a module', () => {
  //   let rule = el('foo')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el($J.any("foo"))')
  // })
});