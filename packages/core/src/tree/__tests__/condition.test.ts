import { amp, bool, co, condition, dimension, el, num, rules, ruleset, sel, sellist } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
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

    it('keeps selector guard comparison canonical even when separately evald selector operands can compare under context', async () => {
      context.session = new EvalSession();

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
      for (const child of find.value as any[]) {
        if ('keySetLibrary' in child) {
          child.keySetLibrary = context.selectorBits;
        }
      }

      const left = sellist([find]);
      left.keySetLibrary = context.selectorBits;

      const right = sel([el('.beta'), co('>'), el('.tail')]);
      right.keySetLibrary = context.selectorBits;
      for (const child of right.value as any[]) {
        if ('keySetLibrary' in child) {
          child.keySetLibrary = context.selectorBits;
        }
      }

      const node = condition([
        left,
        '=',
        right
      ]);

      sessionPatchField(parent, 'selector', patched, context);

      const evaldLeft = await left.eval(context);
      const evaldRight = await right.eval(context);

      expect((evaldLeft as any).compare(evaldRight as any, context)).toBe(0);
      expect(`${await node.eval(context)}`).toBe('false');
      expect(`${await node.eval(new Context())}`).toBe('false');
      expect(parent.selector.valueOf()).toBe('.alpha');
    });
  });
});
