import { any, Bool, bool, call, condition, dimension, list, num, ref, rules, Rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';

let context: Context;

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

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

    it('writes boolean-only condition syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(condition([bool(true)]).toTrimmedString({ writer })).toBe('true');
      expect(writer.toString()).toBe('true');
      expect(writer.reads).toBe(0);
    });

    it('writes negated boolean-only condition syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(condition([bool(false)], { negate: true }).toTrimmedString({ writer })).toBe('not (false)');
      expect(writer.toString()).toBe('not (false)');
      expect(writer.reads).toBe(0);
    });

    it('writes boolean comparison condition syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(condition([bool(true), '=', bool(false)]).toTrimmedString({ writer })).toBe('(true = false)');
      expect(writer.toString()).toBe('(true = false)');
      expect(writer.reads).toBe(0);
    });

    it('writes negated boolean comparison condition syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(condition([bool(true), 'and', bool(false)], { negate: true }).toTrimmedString({ writer })).toBe('not (true and false)');
      expect(writer.toString()).toBe('not (true and false)');
      expect(writer.reads).toBe(0);
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
      let conditionResolveCalls = 0;
      node.resolve = (renderContext: Context) => {
        conditionResolveCalls++;
        return node.evalNode(renderContext);
      };

      expect(node.render(context)).toBe('false');
      expect(conditionResolveCalls).toBe(0);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
    });

    it('renders boolean results without allocating a Bool output node', () => {
      const originalToTrimmedString = Bool.prototype.toTrimmedString;
      let boolStringCalls = 0;
      Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
        this: Bool,
        ...args: Parameters<Bool['toTrimmedString']>
      ) {
        boolStringCalls++;
        return originalToTrimmedString.apply(this, args);
      };
      try {
        const node = condition([
          bool(true),
          '=',
          bool(false)
        ]);

        expect(node.render(context)).toBe('false');
        expect(boolStringCalls).toBe(0);
      } finally {
        Bool.prototype.toTrimmedString = originalToTrimmedString;
      }
    });

    it('renders default() conditions without allocating temporary Bool nodes', async () => {
      const originalToTrimmedString = Bool.prototype.toTrimmedString;
      let boolStringCalls = 0;
      Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
        this: Bool,
        ...args: Parameters<Bool['toTrimmedString']>
      ) {
        boolStringCalls++;
        return originalToTrimmedString.apply(this, args);
      };
      try {
        context.isDefault = true;
        const node = condition([call({ name: 'default' })]);

        expect(await node.render(context)).toBe('true');
        expect(boolStringCalls).toBe(0);
      } finally {
        Bool.prototype.toTrimmedString = originalToTrimmedString;
      }
    });

    it('treats optional fallback default() text as a default guard in comparisons', async () => {
      context.isDefault = false;
      const node = condition([
        bool(false),
        '=',
        call({
          name: ref({ key: 'default' }, { type: 'function', fallbackValue: true })
        }, { silentFail: true })
      ]);

      const resolved = await node.eval(context);

      expect(resolved.value).toBe(true);
    });

    it('renders async comparisons without allocating temporary Bool nodes', async () => {
      const originalToTrimmedString = Bool.prototype.toTrimmedString;
      let boolStringCalls = 0;
      const asyncLeft = bool(true);
      const asyncRight = bool(true);
      asyncLeft.eval = () => Promise.resolve(bool(true));
      asyncRight.eval = () => Promise.resolve(bool(true));
      Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
        this: Bool,
        ...args: Parameters<Bool['toTrimmedString']>
      ) {
        boolStringCalls++;
        return originalToTrimmedString.apply(this, args);
      };
      try {
        const node = condition([
          asyncLeft,
          '=',
          asyncRight
        ]);

        expect(await node.render(context)).toBe('true');
        expect(boolStringCalls).toBe(0);
      } finally {
        Bool.prototype.toTrimmedString = originalToTrimmedString;
      }
    });

    it('renders negated default() conditions through text-only boolean output', async () => {
      context.isDefault = true;
      const node = condition([call({ name: 'default' })], { negate: true });
      const originalEvalNode = node.evalNode;
      let evalCalls = 0;
      node.evalNode = function countEvalNode(
        this: typeof node,
        ...args: Parameters<typeof originalEvalNode>
      ): ReturnType<typeof originalEvalNode> {
        evalCalls++;
        return originalEvalNode.apply(this, args);
      };

      expect(await node.render(context)).toBe('false');
      expect(evalCalls).toBe(0);
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
      expect(node.registrationPrepared).toBe(false);
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
      expect(node.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });

    it('returns Bool nodes without stamping evaluation state onto the source condition', async () => {
      const node = condition([
        bool(true),
        '=',
        bool(true)
      ]);

      const first = await node.resolve(context);
      const second = await node.resolve(context);

      expect(first).toBeInstanceOf(Bool);
      expect(first.value).toBe(true);
      expect(second.value).toBe(true);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
    });

    it('keeps source condition child containers canonical after resolve(context)', async () => {
      const root = rules([
        vardecl({
          name: any('item'),
          value: any('foo')
        })
      ]);
      const evald = await root.eval(context);
      expect(evald).toBeInstanceOf(Rules);
      if (!(evald instanceof Rules)) {
        throw new Error('Expected Rules');
      }
      context.root = evald;
      context.rulesContext = evald;

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
