/* eslint-disable no-return-assign */
export class ListItem<T = unknown> {
  private _lists: LinkedList<LinkedList> | undefined
  get lists() {
    return (this._lists ??= new LinkedList())
  }

  remove() {
    if (this._lists) {
      for (let list of this.lists) {
        list.removeItem(this)
      }
    }
  }
}

/**
 * This is an array-like object but without the overhead of an array.
 * In JS, numbered properties tend to be faster than named properties.
 */
class ListPos<T extends ListItem = ListItem> {
  0: T | undefined
  1: T | undefined
  constructor(
    previous: T | undefined,
    next: T | undefined
  ) {
    this[0] = previous
    this[1] = next
  }
}

interface LinkedListOptions {

}

/**
 * A dynamic linked list useful for managing items in multiple lists.
 * In other words, rather than linking items together, their positions
 * in a list are managed by the list, much like an array.
 *
 *
 */
export class LinkedList<T extends ListItem = ListItem> extends ListItem {
  first: T | undefined
  last: T | undefined
  private _current: T | undefined
  items = new Map<T, ListPos<T>>()

  constructor(items?: T[]) {
    super()
    if (items) {
      let currentItem: T | undefined
      let currentPos: ListPos<T> | undefined
      if (items.length) {
        this.first = items[0]
      }
      for (let item of items) {
        if (currentPos) {
          currentPos[1] = item
        }
        currentPos = new ListPos(currentItem, undefined)
        currentItem = item
        this.items.set(item, currentPos)
        item.lists.add(this)
      }
      this.last = currentItem
    }
  }

  get has() {
    return this.items.has
  }

  get size() {
    return this.items.size
  }

  add(item: T) {
    if (this.items.has(item)) {
      return
    }
    if (!this.first) {
      this.first = item
    }
    let last = this.last
    if (last) {
      this.items.get(last)![1] = item
    }
    this.items.set(item, new ListPos(last, undefined))
    this.last = item
  }

  insertBefore(before: T, item: T) {
    if (this.items.has(item)) {
      return
    }
    let pos = this.items.get(before)
    if (pos) {
      let previous = pos[0]
      if (previous) {
        this.items.get(previous)![1] = item
      }
      pos[0] = item
      this.items.set(item, new ListPos(previous, before))
      if (before === this.first) {
        this.first = item
      }
    }
  }

  insertAfter(after: T, item: T) {
    if (this.items.has(item)) {
      return
    }
    let pos = this.items.get(after)
    if (pos) {
      let next = pos[1]
      if (next) {
        this.items.get(next)![0] = item
      }
      pos[1] = item
      this.items.set(item, new ListPos(after, next))
      if (after === this.last) {
        this.last = item
      }
    }
  }

  * [Symbol.iterator]() {
    let current = this._current = this.first
    while (current !== undefined) {
      yield current
      /**
       * this._current pointer may change because of deletions,
       * but if it's still the same pointer, then increment it
       * to the next position.
       */
      if (current === this._current) {
        current = this._current = this.items.get(current)?.[1]
      } else {
        current = this._current
      }
    }
  }

  * reverse() {
    let current = this._current = this.last
    while (current !== undefined) {
      yield current
      if (current === this._current) {
        current = this._current = this.items.get(current)?.[0]
      } else {
        current = this._current
      }
    }
  }

  removeItem(item: T) {
    let pos = this.items.get(item)
    if (pos) {
      let previous = pos[0]
      let next = pos[1]
      if (previous) {
        this.items.get(previous)![1] = next
      }
      if (next) {
        this.items.get(next)![0] = previous
      }
      this.items.delete(item)
      if (item === this.first) {
        this.first = next
      }
      if (item === this.last) {
        this.last = previous
      }
      if (item === this._current) {
        this._current = next
      }
      item.lists.removeItem(this)
      if (this.items.size === 0) {
        this.remove()
      }
    }
  }
}