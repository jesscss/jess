import { NodeList, Node } from '../node'
import { num } from '../dimension'

function readPos(list: NodeList, nodeRef: number): [number | undefined, number | undefined] {
  // @ts-expect-error - private access
  let pos = list._pos.get(nodeRef)
  if (!pos) {
    return [undefined, undefined]
  }
  // @ts-expect-error - private access
  return [list._getPrevFromBits(pos), list._getNextFromBits(pos)]
}

describe('Linked list', () => {
  test('validate structure', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let list = new NodeList([
      one,
      two,
      three
    ])
    expect(list.first).toBe(1)
    expect(list.last).toBe(3)
    expect(list.size).toBe(3)
    /** These should be the positions of an ordered list */
    expect(readPos(list, 1)).toEqual([undefined, 2])
    expect(readPos(list, 2)).toEqual([1, 3])
    expect(readPos(list, 3)).toEqual([2, undefined])
  })

  it('should create a list from an array', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let list = new NodeList([
      one,
      two,
      three
    ])
    expect([...list].map(n => n.value[0])).toStrictEqual([1, 2, 3])
  })

  it('should insert and remove items', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let four = num(4)
    let list = new NodeList([
      one,
      two,
      three
    ])
    list.add(four)
    expect([...list]).toStrictEqual([one, two, three, four])
    expect([...list].map(n => n.value[0])).toStrictEqual([1, 2, 3, 4])
    expect(list.first).toBe(1)
    expect(list.last).toBe(4)
    expect(two.lists.size).toBe(1)
    two.remove()
    expect([...list]).toStrictEqual([one, three, four])
    expect(two.lists.size).toBe(0)
    list.insertBefore(one, two)
    /** Index is continuously incremented, so it now has an index of 5 */
    expect(list.first).toBe(5)
    /** Right now, no duplicates */
    list.insertAfter(four, two)
    expect(list.last).toBe(4)
    expect([...list]).toStrictEqual([two, one, three, four])
  })

  it('should remove itself from two lists', () => {
    let one = num(1)
    let two = num(2)
    let list1 = new NodeList([one])
    let list2 = new NodeList([one, two])
    expect(one.lists.size).toBe(2)
    expect([...list1]).toStrictEqual([one])
    expect([...list2]).toStrictEqual([one, two])
    one.remove()
    expect([...list1]).toStrictEqual([])
    expect([...list2]).toStrictEqual([two])
  })

  it('should remove itself from two lists', () => {
    let one = num(1)
    let two = num(2)
    let list1 = new NodeList([two])
    let list2 = new NodeList([one, two])
    expect(two.lists.size).toBe(2)
    expect(one.lists.size).toBe(1)
    expect([...list1].map(n => n.value[0])).toStrictEqual([2])
    expect([...list2].map(n => n.value[0])).toStrictEqual([1, 2])
    two.remove()
    expect([...list1].map(n => n.value[0])).toStrictEqual([])
    expect([...list2].map(n => n.value[0])).toStrictEqual([1])
  })

  it('should be reversible', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let list1 = new NodeList([one, two])
    expect([...list1.reverse()].map(n => n.value[0])).toStrictEqual([2, 1])
    let list2 = new NodeList([one, two, three])
    expect([...list2.reverse()].map(n => n.value[0])).toStrictEqual([3, 2, 1])
    two.remove()
    expect([...list1.reverse()].map(n => n.value[0])).toStrictEqual([1])
    expect([...list2.reverse()].map(n => n.value[0])).toStrictEqual([3, 1])
  })

  it('should auto-collapse lists', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let four = num(4)
    let list2 = new NodeList([three, four])
    let list1 = new NodeList([one, two, list2])
    list2.removeItem(three)
    list2.removeItem(four)
    expect([...list1]).toStrictEqual([one, two])
  })
})