import { amp, bool, co, condition, dimension, el, num, rules, ruleset, sel, sellist, seq } from '../index.js';
import { Context } from '../../context.js';

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

  describe('cloned mutation', () => {
    it('renders cloned operands and negate without mutating the canonical node', () => {
      const node = condition([
        bool(true),
        '=',
        bool(false)
      ]);
      const clonedNode = node.clone();
      const left = bool(false);
      const right = bool(true);

      clonedNode.adopt(left, context);
      clonedNode.adopt(right, context);
      (clonedNode as unknown as { left: ReturnType<typeof bool> }).left = left;
      (clonedNode as unknown as { operator: string }).operator = 'or';
      (clonedNode as unknown as { right: ReturnType<typeof bool> }).right = right;
      (clonedNode as unknown as { negate: boolean }).negate = true;

      expect(clonedNode.toTrimmedString({ context })).toBe('not (false or true)');
      expect(node.toTrimmedString()).toBe('(true = false)');
      expect(node.get('left').toTrimmedString()).toBe('true');
      expect(node.get('operator')).toBe('=');
      expect(node.get('right')?.toTrimmedString()).toBe('false');
      expect(node.get('negate')).toBe(false);
    });

    it('evaluates cloned operands and operator without mutating the canonical node', async () => {
      const node = condition([
        bool(true),
        'and',
        bool(false)
      ]);
      const clonedNode = node.clone();
      const left = bool(false);
      const right = bool(true);

      clonedNode.adopt(left, context);
      clonedNode.adopt(right, context);
      (clonedNode as unknown as { left: ReturnType<typeof bool> }).left = left;
      (clonedNode as unknown as { operator: string }).operator = 'or';
      (clonedNode as unknown as { right: ReturnType<typeof bool> }).right = right;

      const evald = await clonedNode.eval(context);

      expect(evald.render(context)).toBe('true');
      expect(`${await node.eval(new Context())}`).toBe('false');
      expect(node.get('left').toTrimmedString()).toBe('true');
      expect(node.get('operator')).toBe('and');
      expect(node.get('right')?.toTrimmedString()).toBe('false');
    });

    it('evaluates cloned negate without mutating the canonical node', async () => {
      const node = condition([
        bool(true)
      ]);
      const clonedNode = node.clone();

      (clonedNode as unknown as { negate: boolean }).negate = true;

      const evald = await clonedNode.eval(context);

      expect(evald.render(context)).toBe('false');
      expect(`${await node.eval(new Context())}`).toBe('true');
      expect(node.get('negate')).toBe(false);
    });
  });
});
