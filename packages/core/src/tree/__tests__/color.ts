import { ColorFormat, color, dimension } from '..'
import { Context } from '../../context'

let context: Context

describe('Color', () => {
  beforeEach(() => {
    context = new Context()
  })
  describe('serialization', () => {
    it('should serialize to a hex color', () => {
      let node = color('#fff')
      expect(`${node}`).toBe('#fff')
    })

    it('should serialize to an rgb color', () => {
      let node = color(ColorFormat.RGB)
      node.rgba = [255, 255, 255, 1]
      expect(`${node}`).toBe('rgb(255, 255, 255)')
    })

    it('should serialize to an rgba color', () => {
      let node = color(ColorFormat.RGB)
      node.rgba = [255, 255, 255, 0.5]
      expect(`${node}`).toBe('rgba(255, 255, 255, 0.5)')
    })

    it('should serialize to an hsl color', () => {
      let node = color(ColorFormat.HSL)
      node.rgba = [255, 255, 255, 1]
      expect(`${node}`).toBe('hsl(0, 0%, 100%)')
    })

    it('should serialize to an hsla color', () => {
      let node = color(ColorFormat.HSL)
      node.rgba = [255, 255, 255, 0.5]
      expect(`${node}`).toBe('hsla(0, 0%, 100%, 0.5)')
    })
  })

  describe('value conversions', () => {
    it('should return rgba', () => {
      let node = color('#fff')
      expect(node.rgba).toStrictEqual([255, 255, 255, 1])
    })

    it('should return rgb', () => {
      let node = color('#fff')
      expect(node.rgb).toStrictEqual([255, 255, 255])
    })

    it('should return alpha', () => {
      let node = color('#fff')
      expect(node.alpha).toStrictEqual(1)
    })

    it('should return hsla', () => {
      let node = color('#fff')
      expect(node.hsla).toStrictEqual([0, 0, 1, 1])
    })
  })

  describe('math', () => {
    it('should add colors', () => {
      let left = color('#111')
      let right = color('#222')
      expect(left.operate(right, '+').toString()).toBe('#333333')
    })

    it('should subtract colors', () => {
      let left = color('#222')
      let right = color('#111')
      expect(left.operate(right, '-').toString()).toBe('#111111')
    })

    it('should multiply a color by a number', () => {
      let left = color('#222')
      let right = dimension([2])
      expect(left.operate(right, '*').toString()).toBe('#444444')
    })

    it('should divide a color by a number', () => {
      let left = color('#222')
      let right = dimension([2])
      expect(left.operate(right, '/').toString()).toBe('#111111')
    })
  })

  describe('errors', () => {
    it('should throw when adding incompatible units', () => {
      let left = color('#fff')
      let right = dimension([2, 'rem'])
      expect(() => left.operate(right, '+', context)).toThrow()
    })

    it('should throw when adding incompatible units', () => {
      let left = dimension([2, 'rem'])
      let right = color('#fff')
      expect(() => left.operate(right, '+', context)).toThrow()
    })
  })
  // it('should serialize to a module', () => {
  //   let rule = dimension('10px')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.num({\n  value: 10,\n  unit: "px"\n})')
  // })
})