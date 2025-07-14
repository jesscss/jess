/** A linked list of Node indices */
export class LinkedList<T extends NODE_INDEX | string> {
  /**
   * A map of a numbered node index to the before / after as a joined number
   * The mapped number is a bit field storing 2 indices.
   */
  private readonly _items = new Map<number, number>();
  private readonly _keys = new BiMap<T, number>();

  keyIndex = 0;

  first: T | undefined;
  last: T | undefined;
  private _current: T | undefined;

  constructor(items?: T[]) {
    if (items?.length) {
      this.push(...items);
    }
  }

  getIndex(item: T) {
    let val = this._keys.get(item);
    if (val !== undefined) {
      return val;
    }
    let key = ++this.keyIndex;
    this._keys.set(item, key);
    return key;
  }

  clear() {
    this._items.clear();
    this.first = undefined;
    this.last = undefined;
    this._current = undefined;
  }

  * [Symbol.iterator]() {
    yield* this._values();
  }

  * values(start?: T) {
    yield* this._values(false, start);
  }

  private _values(asEntries?: false, start?: T): Generator<T, void, any>;
  private _values(asEntries: true, start?: T): Generator<[T, T], void, any>;
  private* _values(asEntries = false, start = this.first) {
    if (!this._keys.has(start!)) {
      throw new Error('Invalid start');
    }
    let currentItem = this._current = start;
    if (currentItem === undefined) {
      return;
    }

    while (currentItem !== undefined) {
      yield asEntries ? [currentItem, currentItem] : currentItem;
      /**
       * this._current pointer may change because of deletions,
       * but if it's still the same pointer, then increment it
       * to the next position.
       */
      const nextItem: T | undefined = currentItem === this._current
        ? this._keys.getValue(
            this._getNextFromBits(this._items.get(this._keys.get(currentItem)!))!
          )
        : this._current;

      currentItem = this._current = nextItem;
    }
  }

  * entries() {
    yield* this._values(true);
  }

  * reverseEntries(start?: T) {
    yield* this._reverse(true, start);
  }

  * reverse(start?: T) {
    yield* this._reverse(false, start);
  }

  _reverse(asEntries?: false, start?: T): Generator<T, void, any>;
  _reverse(asEntries: true, start?: T): Generator<[T, T], void, any>;
  * _reverse(asEntries = false, start = this.last) {
    if (!this._keys.has(start!)) {
      throw new Error('Invalid start index');
    }
    let currentItem = this._current = start;
    if (currentItem === undefined) {
      return;
    }

    while (currentItem !== undefined) {
      yield asEntries ? [currentItem, currentItem] : currentItem;
      /**
     * this._current pointer may change because of deletions,
     * but if it's still the same pointer, then decrement it
     * to the previous position.
     */
      const prevItem: T | undefined = currentItem === this._current
        ? this._keys.getValue(
            this._getPrevFromBits(this._items.get(this._keys.get(currentItem)!))!
          )
        : this._current;

      currentItem = this._current = prevItem;
    }
  }

  has(key: T) {
    return this._keys.has(key);
  }

  private _push(before: T | undefined, after: T | undefined, ...items: T[]) {
    let thisIsFirst = before === this.first;
    let thisIsLast = after === this.last;
    let lastItem: T | undefined;
    let firstItem = items[0];
    let firstIndex: number | undefined;
    let lastIndex: number | undefined;
    if (thisIsFirst && items.length) {
      this.first = firstItem;
    }
    const { _items, _keys } = this;
    for (let item of items) {
      let index = _keys.get(item)!;
      if (firstIndex === undefined) {
        firstIndex = index;
      }
      if (lastIndex) {
        this._writePos(index, lastIndex, 0);
        this._writeNextPos(lastIndex, index);
      } else {
        this._writePos(index, 0, 0);
      }
      lastIndex = index;
      lastItem = item;
    }
    if (thisIsLast) {
      this.last = lastItem;
    }
    /** Update the next / previous of before / after nodes */
    if (before) {
      let beforeIndex = _keys.get(before)!;
      let pos = _items.get(beforeIndex)!;
      if (!thisIsFirst) {
        let previous = this._getPrevFromBits(pos)!;
        this._writeNextPos(previous, firstIndex);
      }
      this._writePrevPos(beforeIndex, lastIndex);
    }
    if (after) {
      let afterIndex = _keys.get(after)!;
      let pos = _items.get(afterIndex)!;
      if (!thisIsLast) {
        let next = this._getNextFromBits(pos)!;
        this._writePrevPos(next, lastIndex);
      }
      this._writeNextPos(afterIndex, firstIndex);
    }
  }

  push(...items: T[]) {
    this._push(undefined, this.last, ...items);
  }

  unshift(...items: T[]) {
    this._push(this.first, undefined, ...items);
  }

  insertBefore(before: T, ...items: T[]) {
    this._push(before, undefined, ...items);
  }

  insertAfter(after: T, ...items: T[]) {
    this._push(undefined, after, ...items);
  }

  private _writePos(nodeRef: number, previous: number | undefined, next: number | undefined) {
    if (nodeRef === previous || nodeRef === next) {
      throw new Error('Linking a node to itself would cause an infinite loop.');
    }
    this._items.set(nodeRef, (previous ?? 0) << 16 | (next ?? 0));
  }

  private _writeNextPos(nodeRef: number, next: number | undefined) {
    let pos = this._items.get(nodeRef);
    if (pos !== undefined) {
      /** Read previous, and write next */
      this._writePos(nodeRef, this._getPrevFromBits(pos), next);
    }
  }

  private _writePrevPos(nodeRef: number, previous: number | undefined) {
    let pos = this._items.get(nodeRef);
    if (pos !== undefined) {
      /** Read next, and write previous */
      this._writePos(nodeRef, previous, this._getNextFromBits(pos));
    }
  }

  private _getPrevFromBits(pos: number | undefined): number | undefined {
    if (pos === undefined) {
      return undefined;
    }
    let previous = (pos >>> 16) & 0xFFFF; // Extract the upper 16 bits
    return previous === 0 ? undefined : previous;
  }

  private _getNextFromBits(pos: number | undefined): number | undefined {
    if (pos === undefined) {
      return undefined;
    }
    let next = pos & 0xffff; // Extract the lower 16 bits
    return next === 0 ? undefined : next;
  }
}