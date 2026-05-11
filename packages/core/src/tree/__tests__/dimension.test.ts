import { dimension, num } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { type Operator } from '../util/calculate.js';

let context: Context;

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context();
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
    //   expect(rule.value.number).toBe(10);
    //   expect(clone.value.number).toBe(10);
    //   expect(rule.value.unit).toBe('px');
    //   expect(rule.value).not.toBe(clone.value);
    //   expect(rule.toString()).toBe('10px');
    // });
    it('should make a dimension from a number', () => {
      let rule = num(10);
      expect(rule.value.number).toBe(10);
      expect(rule.toString()).toBe('10');
    });

    it('renders dimension syntax through toTrimmedString()', () => {
      expect(dimension([10, 'px']).toTrimmedString()).toBe('10px');
      expect(num(10).toTrimmedString()).toBe('10');
    });

    it('renders dimension values through render(context)', () => {
      const sized = dimension([10, 'px']);
      const unitless = num(10);

      expect(sized.render(context)).toBe('10px');
      expect(unitless.render(context)).toBe('10');
      expect(sized.evaluated).toBe(false);
      expect(sized.preEvaluated).toBe(false);
      expect(unitless.evaluated).toBe(false);
      expect(unitless.preEvaluated).toBe(false);
    });

    it('writes dimension render output into flat buffers', async () => {
      const buffer = createRenderBuffer('flat');
      const node = dimension([10, 'px']);

      expect(await node.render(context, buffer)).toBe('10px');
      expect(buffer.parts).toEqual(['10px']);
    });

    it('resolves dimensions without touching render state', async () => {
      const node = dimension([10, 'px']);

      const resolved = await node.resolve(context);

      expect(resolved.toTrimmedString()).toBe('10px');
      expect(node.evaluated).toBe(false);
      expect(node.preEvaluated).toBe(false);
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

    it('should use left-hand units in non-strict mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'rem']);
      await expect(renderOperate(left, right, '-')).resolves.toBe('-10px');
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
      await expect(renderOperate(left, right, '*')).resolves.toBe('20px');
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
      await expect(renderOperate(left, right, '/')).resolves.toBe('5px');
    });
    it('should not cancel units in non-strict mode', async () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      await expect(renderOperate(left, right, '/')).resolves.toBe('5px');
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
