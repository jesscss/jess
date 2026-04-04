import { any, expr, sel, compound, el, co, pseudo, sellist } from '../index.js';
import { Context } from '../../context.js';

let context: Context;

describe('Complex selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('keys', () => {
    test('simple complex', async () => {
      let sel1 = sel([
        compound([
          el('.one'),
          el('.two')
        ]),
        co('>'),
        el('.three')
      ]);
      await sel1.eval(context);
      expect(sel1.keySet.equals(context.selectorBits.getBitset(['.one', '.two', '>', '.three']))).toBe(true);
      expect(sel1.visibleKeySet.equals(context.selectorBits.getBitset(['.one', '.two', '>', '.three']))).toBe(true);
    });
    test('nested complex (w/ relative :is)', async () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: el('a') }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([co('>'), compound([el('.two'), el('.one')])]) as any }) as any
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', '#id', '>', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', '#id', '>', '.two', '.one']))).toBe(true);
    });
    test('nested complex (w/o relative :is)', async () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: el('a') }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) as any }) as any
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
    });
    test(':is w/ selector list', async () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: sellist([el('a'), el('b')]) }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) as any }) as any
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', 'b', '#id', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', 'b', '#id', '.two', '.one']))).toBe(true);
    });

    test(':is w/ complex selector list', async () => {
      let sel2 = sel([
        compound([
          pseudo({
            name: ':is',
            arg: sellist([
              sel([el('a'), co('>'), el('b')]),
              sel([el('c'), co('>'), el('d')])
            ])
          }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) as any }) as any
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', 'b', 'c', 'd', '#id', '>', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', 'b', 'c', 'd', '#id', '>', '.two', '.one']))).toBe(true);
    });
  });

  describe('evaluation', () => {
    it('preserves complex selector serialization while evaluating nested selector children', async () => {
      const node = sel([
        pseudo({
          name: ':not',
          arg: expr(any('blue'))
        }),
        co('>'),
        el('.target')
      ]);

      const evald = await node.eval(context);

      expect(evald.toTrimmedString({ context })).toBe(':not(blue) > .target');
    });

    it('does not re-parent the canonical child when a complex selector collapses to one child with patching', async () => {
      const child = el('.target');
      const node = sel([child]);

      expect(child.parent).toBe(node);

      const evald = await node.eval(context);

      expect(evald).not.toBe(child);
      expect(evald.toTrimmedString({ context })).toBe('.target');
      expect(child.parent).toBe(node);
    });

    it('does not materialize a non-array value back onto the node when valueOf is called', () => {
      const node = sel([el('.one')]) as any;
      node.value = el('.solo');

      expect(node.valueOf()).toBe('.solo');
      expect(Array.isArray(node.value)).toBe(false);
      expect(node.value.valueOf()).toBe('.solo');
    });
  });
});
