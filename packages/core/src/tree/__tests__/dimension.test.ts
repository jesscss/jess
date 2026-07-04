import { setSourceSpan, sourceSpanOf } from '../util/provenance.js';
import { color, dimension, num } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { type Operator } from '../util/calculate.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  marks = 0;
  reads = 0;

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

let context: Context;
let looseContext: Context;

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context();
    looseContext = new Context({ unitMode: 'loose' });
  });

  async function renderOperate(
    left: ReturnType<typeof dimension>,
    right: ReturnType<typeof dimension>,
    operator: Operator,
    opContext = context
  ): Promise<string> {
    const result = left.operate(right, operator, opContext);
    return result.render(opContext);
  }

  describe('serialization', () => {
    /** @todo? */
    // it.only('should make a dimension from a string', () => {
    //   let rule = dimension('10px');
    //   let clone = rule.clone();
    //   expect(rule.number).toBe(10);
    //   expect(clone.number).toBe(10);
    //   expect(rule.unit).toBe('px');
    //   expect(rule.value).not.toBe(clone.value);
    //   expect(rule.toString()).toBe('10px');
    // });
    it('should make a dimension from a number', () => {
      let rule = num(10);
      expect(rule.number).toBe(10);
      expect(rule.toString()).toBe('10');
    });

    it('preserves parser tree context on numeric constructors', () => {
      const treeContext = new TreeContext();
      const sized = dimension([10, 'px'], undefined, undefined, treeContext);
      const unitless = num(10, undefined, undefined, treeContext);

      expect(sized._treeContext).toBe(treeContext);
      expect(unitless._treeContext).toBe(treeContext);
    });

    it('renders dimension syntax through toTrimmedString()', () => {
      expect(dimension([10, 'px']).toTrimmedString()).toBe('10px');
      expect(num(10).toTrimmedString()).toBe('10');
    });

    it('returns dimension syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(dimension([10, 'px']).toTrimmedString({ writer })).toBe('10px');
      expect(dimension([20, 'px*em']).toTrimmedString({ writer })).toBe('calc(20 * 1px * 1em)');
      expect(writer.toString()).toBe('10pxcalc(20 * 1px * 1em)');
      expect(writer.reads).toBe(0);
    });

    it('renders dimension values through render(context)', () => {
      const sized = dimension([10, 'px']);
      const unitless = num(10);

      expect(sized.render(context)).toBe('10px');
      expect(unitless.render(context)).toBe('10');
      expect(sized.registrationPrepared).toBe(false);
      expect(unitless.registrationPrepared).toBe(false);
    });

    it('writes dimension render output into flat buffers', async () => {
      const buffer = createRenderBuffer('flat');
      const node = dimension([10, 'px']);
      let resolveCalls = 0;
      node.resolve = () => {
        resolveCalls++;
        return node;
      };

      expect(await node.render(context, buffer)).toBe('10px');
      expect(buffer.parts).toEqual(['10px']);
      expect(resolveCalls).toBe(0);
    });

    it('renders dimensions without writer mark/readback', () => {
      const writer = new CountingWriter();
      const buffer = createRenderBuffer('flat');

      expect(dimension([10, 'px']).render(context, { writer })).toBe('10px');
      expect(writer.toString()).toBe('10px');
      expect(writer.marks).toBe(0);
      expect(writer.reads).toBe(0);
      expect(dimension([20, 'px*em']).render(context, buffer, { writer })).toBe('calc(20 * 1px * 1em)');
      expect(buffer.parts).toEqual(['calc(20 * 1px * 1em)']);
      expect(writer.marks).toBe(0);
      expect(writer.reads).toBe(0);
    });

    it('resolves dimensions without touching render state', async () => {
      const node = dimension([10, 'px']);

      const resolved = await node.resolve(context);

      expect(resolved.toTrimmedString()).toBe('10px');
      expect(node.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });
  });

  describe('addition/subtraction', () => {
    it('should add the same units', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'px']);
      await expect(renderOperate(left, right, '+')).resolves.toBe('30px');
    });

    it('should subtract the same units', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'px']);
      await expect(renderOperate(left, right, '-')).resolves.toBe('-10px');
    });

    it('defaults arithmetic to preserve mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'rem']);

      await expect(renderOperate(left, right, '-')).resolves.toBe('calc(1px + 1rem)');
      expect(left.operate(right, '-').render(context)).toBe('calc(1px + 1rem)');
    });

    it('should use left-hand units in non-strict mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'rem']);
      await expect(renderOperate(left, right, '-', looseContext)).resolves.toBe('-10px');
    });

    it('should use left-hand units when right has no unit', async () => {
      let left = dimension([10, 'px']);
      let right = num(20);
      await expect(renderOperate(left, right, '-')).resolves.toBe('-10px');
    });

    it('should use right-hand units when left has no unit', async () => {
      let left = num(10);
      let right = dimension([20, 'px']);
      await expect(renderOperate(left, right, '-')).resolves.toBe('-10px');
    });

    it('keeps inherited source metadata on public arithmetic results', () => {
      const left = dimension([10, 'px']);
      const right = dimension([20, 'px']);
      setSourceSpan(left, { start: 10, end: 14 });

      const result = left.operate(right, '+', context);

      expect(result).not.toBe(left);
      expect(sourceSpanOf(result)).toEqual(sourceSpanOf(left));
      expect(result.sourceNode).toBe(result);
    });

    it('keeps inherited source metadata on dimension-to-color operation results', () => {
      const left = dimension(10);
      const right = color('#010203');
      setSourceSpan(left, { start: 20, end: 24 });

      const result = left.operate(right, '+', context);

      expect(result).not.toBe(left);
      expect(result).not.toBe(right);
      expect(sourceSpanOf(result)).toEqual(sourceSpanOf(left));
      expect(result.sourceNode).toBe(result);
    });
  });

  describe('multiplication', () => {
    it('should multiply', async () => {
      let left = dimension([10, 'px']);
      let right = num(2);
      await expect(renderOperate(left, right, '*')).resolves.toBe('20px');
    });
    it('should multiply', async () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '*')).resolves.toBe('20px');
    });
    it('should ignore double units in non-strict mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '*', looseContext)).resolves.toBe('20px');
    });
  });

  describe('division', () => {
    it('should divide', async () => {
      let left = dimension([10, 'px']);
      let right = num(2);
      await expect(renderOperate(left, right, '/')).resolves.toBe('5px');
    });
    it('should divide number by unit (non-strict)', async () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '/', looseContext)).resolves.toBe('5px');
    });
    it('should not cancel units in non-strict mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '/', looseContext)).resolves.toBe('5px');
    });
    it('should cancel units in strict mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      context.opts.unitMode = 'strict';
      await expect(renderOperate(left, right, '/', context)).resolves.toBe('5');
    });
  });

  describe('conversions', () => {
    it('should convert lengths', async () => {
      let left = dimension([1, 'cm']);
      let right = dimension([2, 'mm']);
      await expect(renderOperate(left, right, '+')).resolves.toBe('1.2cm');
      await expect(renderOperate(left, right, '-')).resolves.toBe('0.8cm');
    });
    it('should convert duration', async () => {
      let left = dimension([1, 's']);
      let right = dimension([1, 'ms']);
      await expect(renderOperate(left, right, '+')).resolves.toBe('1.001s');
      await expect(renderOperate(left, right, '-')).resolves.toBe('0.999s');
    });
    it('should convert angle', async () => {
      let left = dimension([1, 'rad']);
      let right = dimension([1, 'deg']);
      // I assume this is correct
      await expect(renderOperate(left, right, '+')).resolves.toBe('1.01745329rad');
    });
  });

  describe('strict mode', () => {
    beforeEach(() => {
      context.opts.unitMode = 'strict';
    });
    it('should throw when adding incompatible units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'rem']);
      expect(() => left.operate(right, '+', context)).toThrow();
    });
    it('should throw when dividing a number by a unit', () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      expect(() => left.operate(right, '/', context)).toThrow();
    });
    it('should throw when multiplying double units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      expect(() => left.operate(right, '*', context)).toThrow();
    });
    it('should throw on divide by zero', () => {
      let left = dimension([10, 'px']);
      let right = num(0);
      expect(() => left.operate(right, '/', context)).toThrow();
    });
    it('should cancel units during division', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '/', context)).resolves.toBe('5');
    });
  });

  describe('preserve mode', () => {
    beforeEach(() => {
      context.opts.unitMode = 'preserve';
    });
    it('should create calc() when adding incompatible units', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'rem']);
      const result = left.operate(right, '+', context);
      const output = await result.render(context);
      // Uncomment to see actual output:
      // console.log('10px + 2rem =', output);
      expect(output).toContain('calc');
      expect(output).toContain('px');
      expect(output).toContain('rem');
    });

    it('keeps preserve-mode compound dimension results as public node surfaces', async () => {
      const left = dimension([10, 'px']);
      const right = dimension([2, 'rem']);
      setSourceSpan(left, { start: 20, end: 24 });

      const result = left.operate(right, '+', context);

      expect(result).not.toBe(left);
      expect(sourceSpanOf(result)).toEqual(sourceSpanOf(left));
      expect(result.sourceNode).toBe(result);
      expect(await result.render(context)).toContain('calc');
    });
    it('should create calc() when dividing a number by a unit', async () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      const result = left.operate(right, '/', context);
      const output = await result.render(context);
      expect(output).toContain('calc');
      expect(output).toContain('px');
    });
    it('should create calc() when multiplying double units', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      const result = left.operate(right, '*', context);
      const output = await result.render(context);
      expect(output).toContain('calc');
      expect(output).toContain('px');
    });
    it('should throw on divide by zero (preserve mode still throws)', () => {
      let left = dimension([10, 'px']);
      let right = num(0);
      expect(() => left.operate(right, '/', context)).toThrow();
    });
    it('should cancel units during division (same as strict)', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '/', context)).resolves.toBe('5');
    });
    it('should create calc() when dividing incompatible units', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 's']);
      const result = left.operate(right, '/', context);
      const output = await result.render(context);
      expect(output).toContain('calc');
      expect(output).toContain('px');
      expect(output).toContain('s');
    });
    it('should create calc() when multiplying incompatible units', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'em']);
      const result = left.operate(right, '*', context);
      const output = await result.render(context);
      expect(output).toContain('calc');
      expect(output).toContain('px');
      expect(output).toContain('em');
    });
    it('should throw when comparing incompatible units (same as strict)', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'rem']);
      expect(() => left.compare(right, context)).toThrow('Incompatible units');
    });
    it('should create calc() for compatible units multiplication', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'cm']);
      const result = left.operate(right, '*', context);
      const output = await result.render(context);
      expect(output).toContain('calc');
      expect(output).toContain('px');
      expect(output).toContain('cm');
    });
    it('should create calc() for compatible units division (different units)', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'cm']);
      const result = left.operate(right, '/', context);
      const output = await result.render(context);
      expect(output).toContain('calc');
      expect(output).toContain('px');
      expect(output).toContain('cm');
    });
  });
  // it('should serialize to a module', () => {
  //   let rule = dimension('10px')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.num({\n  value: 10,\n  unit: "px"\n})')
  // })
});
