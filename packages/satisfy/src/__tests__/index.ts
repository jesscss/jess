import test from 'node:test'
import satisfy from '../index'
import { expect } from 'vitest'

describe('Satisfy', () => {
  it('serializes a simple node', () => {
    expect(satisfy('body { color: red; }')).toBe(
      '<style>body { color: red; }</style>'
    )
  })
})