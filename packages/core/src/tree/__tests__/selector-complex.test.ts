import { any, expr, sel, compound, el, co, pseudo, sellist, amp, rules, ruleset } from '../index.js';
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

    it('propagates a state-only hoist flag when a complex selector collapses to one child', async () => {
      const child = el('.target');
      const node = sel([child]);

      context.activeState.get(node).fields.set('hoistToRoot', true);

      const evald = await node.eval(context);

      expect(evald.hoistToRoot).toBe(true);
      expect(node.hoistToRoot).toBeUndefined();
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

    it('keeps valueOf canonical while render reads a state-patched value array', () => {
      const node = sel([
        el('.one'),
        co('>'),
        el('.two')
      ]);
      const canonicalValue = node.valueOf();

      context.activeState.get(node).fields.set('value', [
        el('.patched'),
        co('>'),
        el('.live')
      ] as any);

      expect(node.toTrimmedString({ context })).toBe('.patched > .live');
      expect(node.valueOf()).toBe(canonicalValue);
      expect(node.get('value').map(component => component.valueOf())).toEqual(['.one', '>', '.two']);
    });

    it('does not materialize a non-array value back onto the node when valueOf is called', () => {
      const node = sel([el('.one')]) as any;
      node.value = el('.solo');

      expect(node.valueOf()).toBe('.solo');
      expect(Array.isArray(node.value)).toBe(false);
      expect(node.value.valueOf()).toBe('.solo');
    });

    it('derives a state-specific complex keySet through an ampersand child', () => {
      const parent = ruleset({
        selector: el('.alpha'),
        rules: rules([])
      });
      parent.get('selector').keySetLibrary = context.selectorBits;

      const node = sel([
        amp({ selectorContainer: parent as any }),
        co('>'),
        el('.tail')
      ]);
      node.keySetLibrary = context.selectorBits;
      for (const child of node.get('value') as any[]) {
        if ('keySetLibrary' in child) {
          child.keySetLibrary = context.selectorBits;
        }
      }

      const patched = el('.beta');
      patched.keySetLibrary = context.selectorBits;
      context.activeState.get(parent).fields.set('selector', patched);

      expect(node.keySet.equals(context.selectorBits.getBitset(['.alpha', '>', '.tail']))).toBe(true);
      expect(node.getKeySet(context).equals(context.selectorBits.getBitset(['.beta', '>', '.tail']))).toBe(true);
    });
  });
});
