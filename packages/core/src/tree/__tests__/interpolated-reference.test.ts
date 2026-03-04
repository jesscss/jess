import { iref, ref, rules, vardecl, decl, any } from '../index.js';
import { Context } from '../../context.js';

describe('interpolated-reference', () => {
  it('serializes as $[ident]', () => {
    const node = iref('ident');
    expect(`${node}`).toBe('$[ident]');
  });

  it('evaluates like a variable reference', async () => {
    const context = new Context();
    const node = rules([
      vardecl({
        name: any('foo'),
        value: any('red')
      }),
      decl({
        name: any('bar'),
        value: iref('foo')
      })
    ]);
    const evald = await node.eval(context);
    expect(`${evald}`).toBeString(`
      bar: red;
    `);
  });

  it('does not enforce identifier regex validation', () => {
    expect(`${iref('1bad')}`).toBe('$[1bad]');
  });

  it('keeps regular references separate', () => {
    const node = ref({ key: 'ident' }, { type: 'variable' });
    expect(`${node}`).toBe('$ident');
  });
});
