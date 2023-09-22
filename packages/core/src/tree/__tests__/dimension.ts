import { dimension, num } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context()
    out = new OutputCollector()
  })
  describe('serialization', () => {
    it('should make a dimension from a string', () => {
      let rule = dimension([10, 'px'])
      let clone = rule.clone()
      expect(rule.number).toBe(10)
      expect(clone.number).toBe(10)
      expect(rule.unit).toBe('px')
      expect(rule.toString()).toBe('10px')
    })
    it('should make a dimension from a number', () => {
      let rule = num(10)
      expect(rule.number).toBe(10)
      expect(rule.toString()).toBe('10')
    })
  })

  describe('addition/subtraction', () => {
    it('should add the same units', () => {
      let left = dimension([10, 'px'])
      let right = dimension([20, 'px'])
      expect(left.operate(right, '+').toString()).toBe('30px')
    })

    it('should subtract the same units', () => {
      let left = dimension([10, 'px'])
      let right = dimension([20, 'px'])
      expect(left.operate(right, '-').toString()).toBe('-10px')
    })

    it('should use left-hand units in non-strict mode', () => {
      let left = dimension([10, 'px'])
      let right = dimension([20, 'rem'])
      expect(left.operate(right, '-').toString()).toBe('-10px')
    })

    it('should use left-hand units when right has no unit', () => {
      let left = dimension([10, 'px'])
      let right = dimension([20])
      expect(left.operate(right, '-').toString()).toBe('-10px')
    })

    it('should use right-hand units when left has no unit', () => {
      let left = dimension([10])
      let right = dimension([20, 'px'])
      expect(left.operate(right, '-').toString()).toBe('-10px')
    })
  })

  describe('multiplication', () => {
    it('should multiply', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2])
      expect(left.operate(right, '*').toString()).toBe('20px')
    })
    it('should multiply', () => {
      let left = dimension([10])
      let right = dimension([2, 'px'])
      expect(left.operate(right, '*').toString()).toBe('20px')
    })
    it('should ignore double units in non-strict mode', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2, 'px'])
      expect(left.operate(right, '*').toString()).toBe('20px')
    })
  })

  describe('division', () => {
    it('should divide', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2])
      expect(left.operate(right, '/').toString()).toBe('5px')
    })
    it('should divide number by unit (non-strict)', () => {
      let left = dimension([10])
      let right = dimension([2, 'px'])
      expect(left.operate(right, '/').toString()).toBe('5px')
    })
    it('should not cancel units in non-strict mode', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2, 'px'])
      expect(left.operate(right, '/').toString()).toBe('5px')
    })
    it('should cancel units in strict mode', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2, 'px'])
      context.opts.unitMode = 1
      expect(left.operate(right, '/', context).toString()).toBe('5')
    })
  })

  describe('conversions', () => {
    it('should convert lengths', () => {
      let left = dimension([1, 'cm'])
      let right = dimension([2, 'mm'])
      expect(left.operate(right, '+').toString()).toBe('1.2cm')
      expect(left.operate(right, '-').toString()).toBe('0.8cm')
    })
    it('should convert duration', () => {
      let left = dimension([1, 's'])
      let right = dimension([1, 'ms'])
      expect(left.operate(right, '+').toString()).toBe('1.001s')
      expect(left.operate(right, '-').toString()).toBe('0.999s')
    })
    it('should convert angle', () => {
      let left = dimension([1, 'rad'])
      let right = dimension([1, 'deg'])
      // I assume this is correct
      expect(left.operate(right, '+').toString()).toBe('1.01745329rad')
    })
  })

  describe('errors', () => {
    beforeEach(() => {
      context.opts.unitMode = 1
    })
    it('should throw when adding incompatible units', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2, 'rem'])
      expect(() => left.operate(right, '+', context)).toThrow()
    })
    it('should throw when dividing a number by a unit', () => {
      let left = dimension([10])
      let right = dimension([2, 'px'])
      expect(() => left.operate(right, '/', context)).toThrow()
    })
    it('should throw when multiplying double units', () => {
      let left = dimension([10, 'px'])
      let right = dimension([2, 'px'])
      expect(() => left.operate(right, '*', context)).toThrow()
    })
    it('should throw on divide by zero', () => {
      let left = dimension([10, 'px'])
      let right = dimension([0])
      // expect(left.operate(right, '/', context).toString()).toBe('5')
      expect(() => left.operate(right, '/', context)).toThrow()
    })
  })
  // it('should serialize to a module', () => {
  //   let rule = dimension('10px')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.num({\n  value: 10,\n  unit: "px"\n})')
  // })
})