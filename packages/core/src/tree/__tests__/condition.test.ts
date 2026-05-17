import { any, bool, condition, dimension, list, num, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';

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
      expect(node.toTrimmedString()).toBe('(true = true)');
    });

    it('should serialize an and', () => {
      let node = condition([
        bool(true),
        'and',
        bool(true)
      ]);
      expect(node.toTrimmedString()).toBe('(true and true)');
    });

    it('should serialize an or', () => {
      let node = condition([
        bool(true),
        'or',
        bool(true)
      ]);
      expect(node.toTrimmedString()).toBe('(true or true)');
    });

    it('should serialize a negated condition', () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ], { negate: true });
      expect(node.toTrimmedString()).toBe('not (true = true)');
    });

    it('does not allocate options when rendering a default condition', () => {
      const node = condition([
        bool(true),
        '=',
        bool(true)
      ]);

      expect(node.toTrimmedString()).toBe('(true = true)');
      expect(Object.getOwnPropertyDescriptor(node, '_options')?.value).toBeUndefined();
    });

    it('renders evaluated condition values through render(context)', () => {
      const node = condition([
        bool(true),
        '=',
        bool(false)
      ]);

      expect(node.render(context)).toBe('false');
      expect(node.evaluated).toBe(false);
      expect(node.preEvaluated).toBe(false);
    });

    it('writes evaluated condition render output into flat buffers', async () => {
      const buffer = createRenderBuffer('flat');
      const node = condition([
        bool(true),
        '=',
        bool(false)
      ]);
      let conditionResolveCalls = 0;
      node.resolve = (renderContext: Context) => {
        conditionResolveCalls++;
        return node.evalNode(renderContext);
      };

      expect(await node.render(context, buffer)).toBe('false');
      expect(buffer.parts).toEqual(['false']);
      expect(conditionResolveCalls).toBe(0);
      expect(node.evaluated).toBe(false);
      expect(node.preEvaluated).toBe(false);
    });

    it('resolves conditions without touching render state', async () => {
      const node = condition([
        bool(true),
        '=',
        bool(false)
      ]);

      const resolved = await node.resolve(context);

      expect(resolved.toTrimmedString()).toBe('false');
      expect(node.evaluated).toBe(false);
      expect(node.preEvaluated).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });

    it('keeps source condition child containers canonical after resolve(context)', async () => {
      const root = rules([
        vardecl({
          name: any('item'),
          value: any('foo')
        })
      ]);
      const evald = await root.eval(context);
      context.root = evald as RulesClass;
      context.rulesContext = evald as RulesClass;

      const node = condition([
        list([
          any('one'),
          ref({ key: 'item' }, { type: 'variable' })
        ])
      ]);
      const resolved = await node.resolve(context);

      expect(resolved.toTrimmedString()).toBe('false');
      expect(node.toTrimmedString()).toBe('one, $item');
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
});
