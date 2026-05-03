import { dimension, num } from '../index.js';
import { Context } from '../../context.js';

let context: Context;

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context();
  });
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

    it('resolves dimensions without touching render state', async () => {
      const resolved = await dimension([10, 'px']).resolve(context);

      expect(resolved.toTrimmedString()).toBe('10px');
      expect(context.printState.writer).toBeUndefined();
    });
  });

  describe('addition/subtraction', () => {
    it('should add the same units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'px']);
      expect(left.operate(right, '+').toString()).toBe('30px');
    });

    it('should subtract the same units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'px']);
      expect(left.operate(right, '-').toString()).toBe('-10px');
    });

    it('should use left-hand units in non-strict mode', () => {
      let left = dimension([10, 'px']);
      let right = dimension([20, 'rem']);
      expect(left.operate(right, '-').toString()).toBe('-10px');
    });

    it('should use left-hand units when right has no unit', () => {
      let left = dimension([10, 'px']);
      let right = num(20);
      expect(left.operate(right, '-').toString()).toBe('-10px');
    });

    it('should use right-hand units when left has no unit', () => {
      let left = num(10);
      let right = dimension([20, 'px']);
      expect(left.operate(right, '-').toString()).toBe('-10px');
    });
  });

  describe('multiplication', () => {
    it('should multiply', () => {
      let left = dimension([10, 'px']);
      let right = num(2);
      expect(left.operate(right, '*').toString()).toBe('20px');
    });
    it('should multiply', () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      expect(left.operate(right, '*').toString()).toBe('20px');
    });
    it('should ignore double units in non-strict mode', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      expect(left.operate(right, '*').toString()).toBe('20px');
    });
  });

  describe('division', () => {
    it('should divide', () => {
      let left = dimension([10, 'px']);
      let right = num(2);
      expect(left.operate(right, '/').toString()).toBe('5px');
    });
    it('should divide number by unit (non-strict)', () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      expect(left.operate(right, '/').toString()).toBe('5px');
    });
    it('should not cancel units in non-strict mode', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      expect(left.operate(right, '/').toString()).toBe('5px');
    });
    it('should cancel units in strict mode', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      context.opts.unitMode = 'strict';
      expect(left.operate(right, '/', context).toString()).toBe('5');
    });
  });

  describe('conversions', () => {
    it('should convert lengths', () => {
      let left = dimension([1, 'cm']);
      let right = dimension([2, 'mm']);
      expect(left.operate(right, '+').toString()).toBe('1.2cm');
      expect(left.operate(right, '-').toString()).toBe('0.8cm');
    });
    it('should convert duration', () => {
      let left = dimension([1, 's']);
      let right = dimension([1, 'ms']);
      expect(left.operate(right, '+').toString()).toBe('1.001s');
      expect(left.operate(right, '-').toString()).toBe('0.999s');
    });
    it('should convert angle', () => {
      let left = dimension([1, 'rad']);
      let right = dimension([1, 'deg']);
      // I assume this is correct
      expect(left.operate(right, '+').toString()).toBe('1.01745329rad');
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
    it('should cancel units during division', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      expect(left.operate(right, '/', context).toString()).toBe('5');
    });
  });

  describe('preserve mode', () => {
    beforeEach(() => {
      context.opts.unitMode = 'preserve';
    });
    it('should create calc() when adding incompatible units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'rem']);
      const result = left.operate(right, '+', context);
      const output = result.toString();
      // Uncomment to see actual output:
      // console.log('10px + 2rem =', output);
      expect(output).toContain('calc');
      expect(output).toContain('px');
      expect(output).toContain('rem');
    });
    it('should create calc() when dividing a number by a unit', () => {
      let left = num(10);
      let right = dimension([2, 'px']);
      const result = left.operate(right, '/', context);
      expect(result.toString()).toContain('calc');
      expect(result.toString()).toContain('px');
    });
    it('should create calc() when multiplying double units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      const result = left.operate(right, '*', context);
      expect(result.toString()).toContain('calc');
      expect(result.toString()).toContain('px');
    });
    it('should throw on divide by zero (preserve mode still throws)', () => {
      let left = dimension([10, 'px']);
      let right = num(0);
      expect(() => left.operate(right, '/', context)).toThrow();
    });
    it('should cancel units during division (same as strict)', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'px']);
      expect(left.operate(right, '/', context).toString()).toBe('5');
    });
    it('should create calc() when dividing incompatible units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 's']);
      const result = left.operate(right, '/', context);
      expect(result.toString()).toContain('calc');
      expect(result.toString()).toContain('px');
      expect(result.toString()).toContain('s');
    });
    it('should create calc() when multiplying incompatible units', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'em']);
      const result = left.operate(right, '*', context);
      expect(result.toString()).toContain('calc');
      expect(result.toString()).toContain('px');
      expect(result.toString()).toContain('em');
    });
    it('should throw when comparing incompatible units (same as strict)', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'rem']);
      expect(() => left.compare(right, context)).toThrow('Incompatible units');
    });
    it('should create calc() for compatible units multiplication', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'cm']);
      const result = left.operate(right, '*', context);
      expect(result.toString()).toContain('calc');
      expect(result.toString()).toContain('px');
      expect(result.toString()).toContain('cm');
    });
    it('should create calc() for compatible units division (different units)', () => {
      let left = dimension([10, 'px']);
      let right = dimension([2, 'cm']);
      const result = left.operate(right, '/', context);
      expect(result.toString()).toContain('calc');
      expect(result.toString()).toContain('px');
      expect(result.toString()).toContain('cm');
    });
  });
  // it('should serialize to a module', () => {
  //   let rule = dimension('10px')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.num({\n  value: 10,\n  unit: "px"\n})')
  // })
});
