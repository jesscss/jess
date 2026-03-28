import { amp, bool, co, condition, dimension, el, num, rules, ruleset, sel, sellist, seq } from '../index.js';
import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';

let context: Context;

describe('Condition', () => {
  beforeEach(() => {
    context = new Context();
  });
  describe('serialization', () => {
    it('should serialize a condition', () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ]);
      expect(`${node}`).toBe('(true = true)');
    });

    it('should serialize an and', () => {
      let node = condition([
        bool(true),
        'and',
        bool(true)
      ]);
      expect(`${node}`).toBe('(true and true)');
    });

    it('should serialize an or', () => {
      let node = condition([
        bool(true),
        'or',
        bool(true)
      ]);
      expect(`${node}`).toBe('(true or true)');
    });

    it('should serialize a negated condition', () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ], { negate: true });
      expect(`${node}`).toBe('not (true = true)');
    });
  });

  describe('evaluation', () => {
    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('true');
    });

    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(false)
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('false');
    });

    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(false)
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('false');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        num(10),
        '=',
        num(10)
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('true');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        num(10),
        '=',
        num(11)
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('false');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([10, 'px']),
        '=',
        dimension([10, 'px'])
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('true');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([1, 's']),
        '=',
        dimension([1000, 'ms'])
      ]);
      let evald = await node.eval(context);
      expect(evald.render(context)).toBe('true');
    });
  });

  describe('eval state', () => {
    it('renders patched operands and negate from the active eval state without mutating the canonical node', () => {
      const node = condition([
        bool(true),
        '=',
        bool(false)
      ]);

      setField(node, 'left', bool(false), context);
      setField(node, 'operator', 'or', context);
      setField(node, 'right', bool(true), context);
      setField(node, 'negate', true, context);

      expect(node.toTrimmedString({ context })).toBe('not (false or true)');
      expect(node.toTrimmedString()).toBe('(true = false)');
      expect(node.get('left').toTrimmedString()).toBe('true');
      expect(node.get('operator')).toBe('=');
      expect(node.get('right')?.toTrimmedString()).toBe('false');
      expect(node.get('negate')).toBe(false);
    });

    it('evaluates patched operands and operator from the active eval state without mutating the canonical node', async () => {
      const node = condition([
        bool(true),
        'and',
        bool(false)
      ]);

      setField(node, 'left', bool(false), context);
      setField(node, 'operator', 'or', context);
      setField(node, 'right', bool(true), context);

      const evald = await node.eval(context);

      expect(evald.render(context)).toBe('true');
      expect(`${await node.eval(new Context())}`).toBe('false');
      expect(node.get('left').toTrimmedString()).toBe('true');
      expect(node.get('operator')).toBe('and');
      expect(node.get('right')?.toTrimmedString()).toBe('false');
    });

    it('evaluates patched negate from the active eval state without mutating the canonical node', async () => {
      const node = condition([
        bool(true)
      ]);

      setField(node, 'negate', true, context);

      const evald = await node.eval(context);

      expect(evald.render(context)).toBe('false');
      expect(`${await node.eval(new Context())}`).toBe('true');
      expect(node.get('negate')).toBe(false);
    });

    it('uses compare(context) for selector guard comparisons when an eval state is active', async () => {
      const parent = ruleset({
        selector: el('.alpha'),
        rules: rules([])
      });
      parent.selector.keySetLibrary = context.selectorBits;

      const patched = el('.beta');
      patched.keySetLibrary = context.selectorBits;

      const find = sel([
        amp({ selectorContainer: parent as any }),
        co('>'),
        el('.tail')
      ]);
      find.keySetLibrary = context.selectorBits;
      for (const child of find.get('value') as any[]) {
        if ('keySetLibrary' in child) {
          child.keySetLibrary = context.selectorBits;
        }
      }

      const left = sellist([find]);
      left.keySetLibrary = context.selectorBits;

      const right = sel([el('.beta'), co('>'), el('.tail')]);
      const otherBits = new Context().selectorBits;
      right.keySetLibrary = otherBits;
      for (const child of right.get('value') as any[]) {
        if ('keySetLibrary' in child) {
          child.keySetLibrary = otherBits;
        }
      }

      const node = condition([
        left,
        '=',
        right
      ]);

      setField(parent, 'selector', patched, context);

      const evaldLeft = await left.eval(context);
      const evaldRight = await right.eval(context);

      expect((evaldLeft as any).compare(evaldRight as any, context)).toBe(0);
      expect(`${await node.eval(context)}`).toBe('true');
      expect(`${await node.eval(new Context())}`).toBe('false');
      expect(parent.selector.valueOf()).toBe('.alpha');
    });

    it('uses compare(context) for sequence guard comparisons when an eval state is active', async () => {
      const left = seq([num(10), num(20)]);
      const right = seq([num(30), num(40)]);
      const node = condition([
        left,
        '=',
        right
      ]);

      setField(left, 'value', [num(30), num(40)], context);

      expect(left.compare(right)).toBe(-1);
      expect(left.compare(right, context)).toBe(0);
      expect(`${await node.eval(context)}`).toBe('true');
      expect(`${await node.eval(new Context())}`).toBe('false');
    });
  });
});
