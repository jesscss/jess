import { ref, rules, vardecl, decl, any } from '../index.js';
import { Context } from '../../context.js';

/** Reference with role=ident serializes as $[ident] (interpolation slot form) */
describe('Reference role=ident (interpolation slot)', () => {
  it('serializes as $[ident]', () => {
    const node = ref({ key: 'ident' }, { type: 'variable', role: 'ident' });
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
        value: ref({ key: 'foo' }, { type: 'variable', role: 'ident' })
      })
    ]);
    const evald = await node.eval(context);
    expect(evald.render(context)).toBeString(`
      bar: red;
    `);
  });

  it('does not enforce identifier regex validation', () => {
    const node = ref({ key: '1bad' }, { type: 'variable', role: 'ident' });
    expect(`${node}`).toBe('$[1bad]');
  });

  it('preserves the key through clone and copy', () => {
    const node = ref({ key: 'theme' }, { type: 'variable', role: 'ident' });
    expect(`${node.clone()}`).toBe('$[theme]');
    expect(`${node.copy()}`).toBe('$[theme]');
  });

  it('keeps regular references separate', () => {
    const node = ref({ key: 'ident' }, { type: 'variable' });
    expect(`${node}`).toBe('$ident');
  });
});
