import { default as OriginalBitSet } from 'bitset';

export class BitSet<T = unknown> extends OriginalBitSet {
  _library: BitSetLibrary<T> | undefined;

  override or(other: BitSet<T>): BitSet<T> {
    let set = super.or(other) as BitSet<T>;
    set._library = this._library;
    return set;
  }

  override clone(): BitSet<T> {
    let set: any = new BitSet<T>();
    /**
     * Clone like the regular bitset does but preserve this as the constructor.
     * Otherwise cloned objects won't preserve the library reference.
     */
    set.data = (this as any).data.slice();
    set._ = (this as any)._;
    set._library = this._library;
    return set;
  }

  override and(other: BitSet<T>): BitSet<T> {
    let set = super.and(other) as BitSet<T>;
    set._library = this._library;
    return set;
  }

  override xor(other: BitSet<T>): BitSet<T> {
    let set = super.xor(other) as BitSet<T>;
    set._library = this._library;
    return set;
  }

  override not(): BitSet<T> {
    let set = super.not() as BitSet<T>;
    set._library = this._library;
    return set;
  }
}

export class BitSetLibrary<T = unknown> {
  private _bitset: BitSet<T>;
  /** Value to Bitset position map */
  private _values = new Map<T, number>();

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

  /** Returns position */
  add(value: T): number {
    let values = this._values;
    let pos = values.get(value);
    if (pos !== undefined) {
      return pos;
    }
    pos = this.size;
    values.set(value, pos);
    this._bitset.set(pos, 0);
    return pos;
  }

  has(value: T) {
    return this._values.has(value);
  }

  /** Get Bitset from an iterable of values */
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
}

/**
 * All bits in a that are true must be true in b
*/
export function isSubsetOf(a: BitSet, b: BitSet): boolean {
  if (a._library !== b._library) {
    throw new Error('Bitsets must be from the same library');
  }
  return a.and(b).equals(a);
}

/** True when `a` and `b` share no set bits. */
export function isDisjoint(a: BitSet, b: BitSet): boolean {
  if (a._library !== b._library) {
    throw new Error('Bitsets must be from the same library');
  }
  return a.and(b).equals(a._library!.getBitset());
}
