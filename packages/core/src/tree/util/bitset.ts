import { default as OriginalBitSet } from 'bitset';

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === 'number');
}

function dataOf(bitset: OriginalBitSet & { data?: unknown }): number[] | undefined {
  const data: unknown = bitset.data;
  return isNumberArray(data) ? data : undefined;
}

function isInverted(bitset: OriginalBitSet & { _?: unknown }): boolean {
  return bitset._ === 1;
}

function withLibrary<T>(bitset: OriginalBitSet, library: BitSetLibrary<T> | undefined): BitSet<T> {
  const set = new BitSet<T>(bitset);
  set._library = library;
  return set;
}

export class BitSet<T = unknown> extends OriginalBitSet {
  _library: BitSetLibrary<T> | undefined;

  override or(other: BitSet<T>): BitSet<T> {
    return withLibrary(super.or(other), this._library);
  }

  override clone(): BitSet<T> {
    return withLibrary(super.clone(), this._library);
  }

  override and(other: BitSet<T>): BitSet<T> {
    return withLibrary(super.and(other), this._library);
  }

  override xor(other: BitSet<T>): BitSet<T> {
    return withLibrary(super.xor(other), this._library);
  }

  override not(): BitSet<T> {
    return withLibrary(super.not(), this._library);
  }
}

export class BitSetLibrary<T = unknown> {
  private _bitset: BitSet<T>;
  private _values = new Map<T, number>();
  private _positions: T[] = [];

  constructor(values?: T[]) {
    this._bitset = new BitSet();
    this._bitset._library = this;
    if (values) {
      for (let i = 0; i < values.length; i++) {
        this._values.set(values[i]!, i);
        this._bitset.set(i, 0);
      }
    }
  }

  get size() {
    return this._values.size;
  }

  add(value: T): number {
    let values = this._values;
    let pos = values.get(value);
    if (pos !== undefined) {
      return pos;
    }
    pos = this.size;
    values.set(value, pos);
    this._positions[pos] = value;
    this._bitset.set(pos, 0);
    return pos;
  }

  has(value: T) {
    return this._values.has(value);
  }

  getBitset(values?: Iterable<T>): BitSet<T> {
    let bitset = this._bitset.clone();
    if (values) {
      for (const value of values) {
        let pos = this.add(value);
        bitset.set(pos, 1);
      }
    }
    return bitset;
  }

  getValue(position: number): T | undefined {
    return this._positions[position];
  }

  forEachValue(bitset: BitSet<T>, fn: (value: T, position: number) => void): void {
    const data = dataOf(bitset);
    if (!data) {
      return;
    }
    for (let wordIndex = 0; wordIndex < data.length; wordIndex++) {
      let word = data[wordIndex]! >>> 0;
      while (word !== 0) {
        const lowestBit = word & -word;
        const bitIndex = 31 - Math.clz32(lowestBit);
        const position = (wordIndex * 32) + bitIndex;
        const value = this._positions[position];
        if (value !== undefined) {
          fn(value, position);
        }
        word &= word - 1;
      }
    }
  }

  valuesOf(bitset: BitSet<T>): T[] {
    const values: T[] = [];
    this.forEachValue(bitset, (value) => {
      values.push(value);
    });
    return values;
  }

  hasBit(bitset: BitSet<T>, value: T): boolean {
    const pos = this._values.get(value);
    if (pos === undefined) {
      return false;
    }
    return bitset.get(pos) === 1;
  }
}

/** All bits in a that are true must be true in b */
export function isSubsetOf(a: BitSet, b: BitSet): boolean {
  if (a._library !== b._library) {
    throw new Error('Bitsets must be from the same library');
  }
  if (isInverted(a) || isInverted(b)) {
    return a.and(b).equals(a);
  }

  const aData = dataOf(a);
  const bData = dataOf(b);
  if (!aData) {
    return true;
  }

  for (let i = 0; i < aData.length; i++) {
    const aWord = aData[i] ?? 0;
    if (!aWord) {
      continue;
    }
    const bWord = bData?.[i] ?? 0;
    if ((aWord & ~bWord) !== 0) {
      return false;
    }
  }

  return true;
}

/** True when a and b share no set bits */
export function isDisjoint(a: BitSet, b: BitSet): boolean {
  if (a._library !== b._library) {
    throw new Error('Bitsets must be from the same library');
  }
  if (!isInverted(a) && !isInverted(b)) {
    const aData = dataOf(a);
    const bData = dataOf(b);
    if (!aData || !bData) {
      return true;
    }
    const length = Math.min(aData.length, bData.length);
    for (let i = 0; i < length; i++) {
      if (((aData[i] ?? 0) & (bData[i] ?? 0)) !== 0) {
        return false;
      }
    }
    return true;
  }
  const intersection = a.and(b);
  const data = dataOf(intersection);
  if (!data) {
    return true;
  }
  for (let i = 0; i < data.length; i++) {
    if (data[i]) {
      return false;
    }
  }
  return true;
}
