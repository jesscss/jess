import { list, spaced, num, any } from '..'
import { Context } from '../../context'

let context: Context

describe('List', () => {
  beforeEach(() => {
    context = new Context()
  })
  it('should serialize to a list', () => {
    let rule = list([spaced([num(1), any('2'), any('3')]), any('four')])
    expect(`${rule}`).toBe('1 2 3, four')
  })
  // it('should serialize to a module', () => {
  //   let rule = list([spaced([any('1'), any('2'), any('3')]), any('four')])
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.list([\n  $J.spaced([$J.any("1"), $J.any("2"), $J.any("3")]),\n  "four"\n])'
  //   )
  // })
})