import { bool, condition, dimension } from '..'
import { Context } from '../../context'

let context: Context

describe('Condition', () => {
  beforeEach(() => {
    context = new Context()
  })
  describe('serialization', () => {
    it('should serialize a condition', () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ])
      expect(`${node}`).toBe('true = true')
    })

    it('should serialize an and', () => {
      let node = condition([
        bool(true),
        'and',
        bool(true)
      ])
      expect(`${node}`).toBe('true and true')
    })

    it('should serialize an or', () => {
      let node = condition([
        bool(true),
        'or',
        bool(true)
      ])
      expect(`${node}`).toBe('true or true')
    })

    it('should serialize a negated condition', () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ], { negate: true })
      expect(`${node}`).toBe('not(true = true)')
    })
  })

  describe('evaluation', () => {
    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(true)
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('true')
    })

    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(false)
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('false')
    })

    it('should evaluate a condition', async () => {
      let node = condition([
        bool(true),
        '=',
        bool(false)
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('false')
    })

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([10]),
        '=',
        dimension([10])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('true')
    })

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([10]),
        '=',
        dimension([11])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('false')
    })

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([10, 'px']),
        '=',
        dimension([10, 'px'])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('true')
    })

    it('should compare dimensions', async () => {
      let node = condition([
        dimension([1, 's']),
        '=',
        dimension([1000, 'ms'])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBe('true')
    })
  })
})