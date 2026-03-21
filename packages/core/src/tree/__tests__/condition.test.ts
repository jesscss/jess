import { bool, condition, dimension, num } from '..';
import { Context } from '../../context.js';
import { sessionPatchField } from '../util/session-helpers.js';

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
      expect(`${evald}`).toBe('true');
    });

    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(false)
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBe('false');
    });

    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(false)
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBe('false');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        num(10),
        '=',
        num(10)
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBe('true');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        num(10),
        '=',
        num(11)
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBe('false');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([10, 'px']),
        '=',
        dimension([10, 'px'])
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBe('true');
    });

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([1, 's']),
        '=',
        dimension([1000, 'ms'])
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBe('true');
    });
  });

  describe('session', () => {
    it('renders patched operands and negate from the active session without mutating the canonical node', () => {
      context.createSession();
      const node = condition([
        bool(true),
        '=',
        bool(false)
      ]);

      sessionPatchField(node, 'left', bool(false), context);
      sessionPatchField(node, 'operator', 'or', context);
      sessionPatchField(node, 'right', bool(true), context);
      sessionPatchField(node, 'negate', true, context);

      expect(node.toTrimmedString({ context })).toBe('not (false or true)');
      expect(node.toTrimmedString()).toBe('(true = false)');
      expect(node.left.toTrimmedString()).toBe('true');
      expect(node.operator).toBe('=');
      expect(node.right?.toTrimmedString()).toBe('false');
      expect(node.negate).toBe(false);
    });

    it('evaluates patched operands and operator from the active session without mutating the canonical node', async () => {
      context.createSession();
      const node = condition([
        bool(true),
        'and',
        bool(false)
      ]);

      sessionPatchField(node, 'left', bool(false), context);
      sessionPatchField(node, 'operator', 'or', context);
      sessionPatchField(node, 'right', bool(true), context);

      const evald = await node.eval(context);

      expect(`${evald}`).toBe('true');
      expect(`${await node.eval(new Context())}`).toBe('false');
      expect(node.left.toTrimmedString()).toBe('true');
      expect(node.operator).toBe('and');
      expect(node.right?.toTrimmedString()).toBe('false');
    });

    it('evaluates patched negate from the active session without mutating the canonical node', async () => {
      context.createSession();
      const node = condition([
        bool(true)
      ]);

      sessionPatchField(node, 'negate', true, context);

      const evald = await node.eval(context);

      expect(`${evald}`).toBe('false');
      expect(`${await node.eval(new Context())}`).toBe('true');
      expect(node.negate).toBe(false);
    });
  });
});
