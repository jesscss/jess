import { NodeList, Node } from '../node'
import { num } from '../dimension'

describe('Linked list', () => {
  it('should create a list from an array', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let four = num(4)
    let list = new NodeList([
      one,
      two,
      three
    ])
    expect([...list]).toStrictEqual([one, two, three])
    expect(list.first).toBe(one)
    expect(list.last).toBe(three)
    list.add(four)
    expect([...list]).toStrictEqual([one, two, three, four])
    expect(list.first).toBe(one)
    expect(list.last).toBe(four)
    expect(two.lists.size).toBe(1)
    two.remove()
    expect([...list]).toStrictEqual([one, three, four])
    expect(two.lists.size).toBe(0)
    list.insertBefore(one, two)
    expect(list.first).toBe(two)
    /** Right now, no duplicates */
    list.insertAfter(four, two)
    expect(list.last).toBe(four)
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
    expect([...list1]).toStrictEqual([two])
    expect([...list2]).toStrictEqual([one, two])
    two.remove()
    expect([...list1]).toStrictEqual([])
    expect([...list2]).toStrictEqual([one])
  })

  it('should be reversible', () => {
    let one = num(1)
    let two = num(2)
    let three = num(3)
    let list1 = new NodeList([one, two])
    let list2 = new NodeList([one, two, three])
    two.remove()
    expect([...list1.reverse()]).toStrictEqual([one])
    expect([...list2.reverse()]).toStrictEqual([three, one])
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