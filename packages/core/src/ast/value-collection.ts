/**
 * Value-domain MAP capabilities — the accessors a map function library reads a
 * {@link Collection} through.
 *
 * The one thing that cannot live in a dialect package is KEY IDENTITY: a Sass map
 * keys by VALUE equality (`(1: a)` is hit by the number `1`, `("a": b)` by the
 * unquoted `a`), which is the same `compare` the guards use. Owning it here keeps
 * every map function on one definition of "same key" and stops any of them from
 * falling back to comparing rendered bytes.
 *
 * HARD MODULE BOUNDARY: imports only the value domain + the value comparator.
 */
import { isValueGroupArray, type Collection, type CollectionEntry, type ValueGroup } from './value-eval.js';
import {
  compare,
  sassCollectionMemberEqual,
  writeSassEqualityCandidatePlan,
  SASS_EQUAL
} from './value-guards.js';

type CandidateBucket = number | Set<number>;
type CandidateBuckets = Map<string, CandidateBucket>;

/* Numeric equality exposes many tolerance buckets. Pairing every key spelling
 * with every value spelling would turn one entry into hundreds of composite
 * strings, so composites stay a small scalar-only accelerator. */
const MAX_PAIR_SIGNATURE_PRODUCT = 16;

const isScalarPairMember = (value: ValueGroup): boolean =>
  !isValueGroupArray(value) && value.type !== 'List' && value.type !== 'Collection';

/**
 * Build an ordered collection with the language's later-value-wins semantics.
 * Replacing a key keeps its original position but stores the incoming key: that
 * detail matters because Sass equality is intentionally cross-kind and is not
 * transitive for every quoted/keyword/colour combination.
 *
 * Candidate indexes keep ordinary scalar overlays linear, including quoted,
 * numeric, and colour keys. Exact comparison is still the final authority: the
 * indexes only narrow the possible matches, and the lowest matching index wins.
 */
export class CollectionOverlay<T> {
  readonly items: T[] = [];
  private readonly keys: ValueGroup[] = [];
  private buckets: CandidateBuckets | null = null;
  private pairBuckets: CandidateBuckets | null = null;
  private outerSeen: number[] | null = null;
  private pass = 0;
  private signatures: string[] | null = null;
  private groupEnds: number[] | null = null;
  private fallbackSignatures: string[] | null = null;
  private oldSignatures: string[] | null = null;
  private oldGroupEnds: number[] | null = null;
  private oldFallbackSignatures: string[] | null = null;

  private addToBucket(
    buckets: CandidateBuckets,
    signature: string,
    index: number
  ): void {
    const current = buckets.get(signature);
    if (current === undefined) {
      buckets.set(signature, index);
    } else if (typeof current === 'number') {
      if (current !== index) {
        const set = new Set<number>();
        set.add(current);
        set.add(index);
        buckets.set(signature, set);
      }
    } else {
      current.add(index);
    }
  }

  private removeFromBucket(
    buckets: CandidateBuckets,
    signature: string,
    index: number
  ): void {
    const current = buckets.get(signature);
    if (typeof current === 'number') {
      if (current === index) {
        buckets.delete(signature);
      }
      return;
    }
    if (current === undefined) {
      return;
    }
    current.delete(index);
    if (current.size === 0) {
      buckets.delete(signature);
    } else if (current.size === 1) {
      buckets.set(signature, current.values().next().value!);
    }
  }

  private writePlan(
    key: ValueGroup,
    signatures: string[],
    groupEnds: number[],
    fallbackSignatures: string[]
  ): void {
    signatures.length = 0;
    groupEnds.length = 0;
    fallbackSignatures.length = 0;
    writeSassEqualityCandidatePlan(key, signatures, groupEnds, fallbackSignatures);
  }

  private rootSignature(key: ValueGroup): string | null {
    if (isValueGroupArray(key)) {
      return null;
    }
    return `root:${'quote' in key ? key.value : key.bytes}`;
  }

  private writePairSignatures(
    key: ValueGroup,
    value: ValueGroup,
    into: CandidateBuckets,
    outer: number,
    add: boolean
  ): void {
    const signatures = this.signatures ??= [];
    const groupEnds = this.groupEnds ??= [];
    const fallbackSignatures = this.fallbackSignatures ??= [];
    const valueSignatures = this.oldSignatures ??= [];
    const valueGroupEnds = this.oldGroupEnds ??= [];
    const valueFallbackSignatures = this.oldFallbackSignatures ??= [];
    this.writePlan(key, signatures, groupEnds, fallbackSignatures);
    this.writePlan(value, valueSignatures, valueGroupEnds, valueFallbackSignatures);

    /* Individual postings are the conservative association index. They cover
     * structural↔string equality at any nesting depth; a composite hit is only
     * an upper bound because an earlier cross-spelling match may still exist. */
    for (let index = 0; index < signatures.length; index += 1) {
      const signature = `pair-key:${signatures[index]!}`;
      if (add) {
        this.addToBucket(into, signature, outer);
      } else {
        this.removeFromBucket(into, signature, outer);
      }
    }
    for (let index = 0; index < fallbackSignatures.length; index += 1) {
      const signature = `pair-key:${fallbackSignatures[index]!}`;
      if (add) {
        this.addToBucket(into, signature, outer);
      } else {
        this.removeFromBucket(into, signature, outer);
      }
    }
    for (let index = 0; index < valueSignatures.length; index += 1) {
      const signature = `pair-value:${valueSignatures[index]!}`;
      if (add) {
        this.addToBucket(into, signature, outer);
      } else {
        this.removeFromBucket(into, signature, outer);
      }
    }
    for (let index = 0; index < valueFallbackSignatures.length; index += 1) {
      const signature = `pair-value:${valueFallbackSignatures[index]!}`;
      if (add) {
        this.addToBucket(into, signature, outer);
      } else {
        this.removeFromBucket(into, signature, outer);
      }
    }
    if (isScalarPairMember(key)
      && isScalarPairMember(value)
      && groupEnds.length === 1
      && valueGroupEnds.length === 1
      && signatures.length * valueSignatures.length <= MAX_PAIR_SIGNATURE_PRODUCT) {
      for (const keySignature of signatures) {
        for (const valueSignature of valueSignatures) {
          const signature = `pair:${keySignature.length}:${keySignature}${valueSignature}`;
          if (add) {
            this.addToBucket(into, signature, outer);
          } else {
            this.removeFromBucket(into, signature, outer);
          }
        }
      }
    }
  }

  private indexKey(key: ValueGroup, index: number): void {
    const buckets = this.buckets!;
    const root = this.rootSignature(key);
    if (root !== null) {
      this.addToBucket(buckets, root, index);
    }
    if (!isValueGroupArray(key) && key.type === 'Collection') {
      const pairBuckets = this.pairBuckets ??= new Map();
      for (let entryIndex = 0; entryIndex < key.entries.length; entryIndex += 1) {
        const entry = key.entries[entryIndex]!;
        this.writePairSignatures(entry.key, entry.value, pairBuckets, index, true);
      }
      return;
    }
    const signatures = this.signatures ??= [];
    const groupEnds = this.groupEnds ??= [];
    const fallbackSignatures = this.fallbackSignatures ??= [];
    this.writePlan(key, signatures, groupEnds, fallbackSignatures);
    for (const signature of signatures) {
      this.addToBucket(buckets, signature, index);
    }
    for (const signature of fallbackSignatures) {
      this.addToBucket(buckets, signature, index);
    }
  }

  private unindexKey(key: ValueGroup, index: number): void {
    const buckets = this.buckets!;
    const root = this.rootSignature(key);
    if (root !== null) {
      this.removeFromBucket(buckets, root, index);
    }
    if (!isValueGroupArray(key) && key.type === 'Collection') {
      const pairBuckets = this.pairBuckets!;
      for (let entryIndex = 0; entryIndex < key.entries.length; entryIndex += 1) {
        const entry = key.entries[entryIndex]!;
        this.writePairSignatures(entry.key, entry.value, pairBuckets, index, false);
      }
      return;
    }
    const signatures = this.signatures ??= [];
    const groupEnds = this.groupEnds ??= [];
    const fallbackSignatures = this.fallbackSignatures ??= [];
    this.writePlan(key, signatures, groupEnds, fallbackSignatures);
    for (const signature of signatures) {
      this.removeFromBucket(buckets, signature, index);
    }
    for (const signature of fallbackSignatures) {
      this.removeFromBucket(buckets, signature, index);
    }
  }

  private ensureIndex(): void {
    if (this.buckets !== null) {
      return;
    }
    this.buckets = new Map();
    this.outerSeen = [];
    for (let index = 0; index < this.keys.length; index += 1) {
      this.indexKey(this.keys[index]!, index);
    }
  }

  private bucketSize(bucket: CandidateBucket | undefined): number {
    return typeof bucket === 'number' ? 1 : bucket?.size ?? 0;
  }

  private testOuter(candidate: number, key: ValueGroup, pass: number, existing: number): number {
    const seen = this.outerSeen!;
    if (seen[candidate] === pass) {
      return existing;
    }
    seen[candidate] = pass;
    if ((existing < 0 || candidate < existing) && compare(SASS_EQUAL, this.keys[candidate]!, key)) {
      return candidate;
    }
    return existing;
  }

  private scanBucket(
    bucket: CandidateBucket | undefined,
    key: ValueGroup,
    pass: number,
    existing: number
  ): number {
    if (typeof bucket === 'number') {
      return this.testOuter(bucket, key, pass, existing);
    }
    if (bucket !== undefined) {
      for (const candidate of bucket) {
        existing = this.testOuter(candidate, key, pass, existing);
      }
    }
    return existing;
  }

  private hasPair(candidate: number, key: ValueGroup, value: ValueGroup): boolean {
    const stored = this.keys[candidate]!;
    if (isValueGroupArray(stored) || stored.type !== 'Collection') {
      return false;
    }
    for (let index = 0; index < stored.entries.length; index += 1) {
      const entry = stored.entries[index]!;
      if (sassCollectionMemberEqual(entry.key, key)
        && sassCollectionMemberEqual(entry.value, value)) {
        return true;
      }
    }
    return false;
  }

  private testPairOuter(
    candidate: number,
    pairKey: ValueGroup,
    pairValue: ValueGroup,
    key: ValueGroup,
    pass: number,
    existing: number
  ): number {
    const seen = this.outerSeen!;
    if (seen[candidate] === pass) {
      return existing;
    }
    seen[candidate] = pass;
    if (existing >= 0 && candidate >= existing) {
      return existing;
    }
    if (this.hasPair(candidate, pairKey, pairValue)
      && compare(SASS_EQUAL, this.keys[candidate]!, key)) {
      return candidate;
    }
    return existing;
  }

  private scanPairBucket(
    bucket: CandidateBucket | undefined,
    pairKey: ValueGroup,
    pairValue: ValueGroup,
    key: ValueGroup,
    pass: number,
    existing: number
  ): number {
    if (typeof bucket === 'number') {
      return this.testPairOuter(bucket, pairKey, pairValue, key, pass, existing);
    }
    if (bucket !== undefined) {
      for (const candidate of bucket) {
        existing = this.testPairOuter(candidate, pairKey, pairValue, key, pass, existing);
      }
    }
    return existing;
  }

  private indexOf(key: ValueGroup): number {
    const pass = ++this.pass;
    let existing = -1;
    const root = this.rootSignature(key);
    if (root !== null) {
      existing = this.scanBucket(this.buckets!.get(root), key, pass, existing);
    }
    if (!isValueGroupArray(key) && key.type === 'Collection') {
      if (key.entries.length === 0 || this.pairBuckets === null) {
        return existing;
      }
      const signatures = this.signatures ??= [];
      const groupEnds = this.groupEnds ??= [];
      const fallbackSignatures = this.fallbackSignatures ??= [];
      const valueSignatures = this.oldSignatures ??= [];
      const valueGroupEnds = this.oldGroupEnds ??= [];
      const valueFallbackSignatures = this.oldFallbackSignatures ??= [];
      let bestEntry = 0;
      let bestSide: 'key' | 'value' = 'key';
      let bestGroup = 0;
      let smallest = Number.POSITIVE_INFINITY;
      for (let entryIndex = 0; entryIndex < key.entries.length; entryIndex += 1) {
        const entry = key.entries[entryIndex]!;
        this.writePlan(entry.key, signatures, groupEnds, fallbackSignatures);
        this.writePlan(
          entry.value,
          valueSignatures,
          valueGroupEnds,
          valueFallbackSignatures
        );
        if (isScalarPairMember(entry.key)
          && isScalarPairMember(entry.value)
          && groupEnds.length === 1
          && valueGroupEnds.length === 1
          && signatures.length * valueSignatures.length <= MAX_PAIR_SIGNATURE_PRODUCT) {
          for (const keySignature of signatures) {
            for (const valueSignature of valueSignatures) {
              existing = this.scanPairBucket(
                this.pairBuckets.get(`pair:${keySignature.length}:${keySignature}${valueSignature}`),
                entry.key,
                entry.value,
                key,
                pass,
                existing
              );
            }
          }
        }
        for (let index = 0; index < fallbackSignatures.length; index += 1) {
          existing = this.scanPairBucket(
            this.pairBuckets.get(`pair-key:${fallbackSignatures[index]!}`),
            entry.key,
            entry.value,
            key,
            pass,
            existing
          );
        }
        for (let index = 0; index < valueFallbackSignatures.length; index += 1) {
          existing = this.scanPairBucket(
            this.pairBuckets.get(`pair-value:${valueFallbackSignatures[index]!}`),
            entry.key,
            entry.value,
            key,
            pass,
            existing
          );
        }
        let start = 0;
        for (let group = 0; group < groupEnds.length; group += 1) {
          const end = groupEnds[group]!;
          let candidates = 0;
          for (let signatureIndex = start; signatureIndex < end; signatureIndex += 1) {
            candidates += this.bucketSize(
              this.pairBuckets.get(`pair-key:${signatures[signatureIndex]!}`)
            );
          }
          if (candidates > 0 && candidates < smallest) {
            smallest = candidates;
            bestEntry = entryIndex;
            bestSide = 'key';
            bestGroup = group;
          } else if (candidates === 0) {
            return existing;
          }
          start = end;
        }
        start = 0;
        for (let group = 0; group < valueGroupEnds.length; group += 1) {
          const end = valueGroupEnds[group]!;
          let candidates = 0;
          for (let signatureIndex = start; signatureIndex < end; signatureIndex += 1) {
            candidates += this.bucketSize(
              this.pairBuckets.get(`pair-value:${valueSignatures[signatureIndex]!}`)
            );
          }
          if (candidates > 0 && candidates < smallest) {
            smallest = candidates;
            bestEntry = entryIndex;
            bestSide = 'value';
            bestGroup = group;
          } else if (candidates === 0) {
            return existing;
          }
          start = end;
        }
      }
      if (smallest === Number.POSITIVE_INFINITY) {
        return existing;
      }
      const selected = key.entries[bestEntry]!;
      this.writePlan(selected.key, signatures, groupEnds, fallbackSignatures);
      this.writePlan(
        selected.value,
        valueSignatures,
        valueGroupEnds,
        valueFallbackSignatures
      );
      if (bestSide === 'key') {
        const start = bestGroup === 0 ? 0 : groupEnds[bestGroup - 1]!;
        const end = groupEnds[bestGroup]!;
        for (let signatureIndex = start; signatureIndex < end; signatureIndex += 1) {
          existing = this.scanPairBucket(
            this.pairBuckets.get(`pair-key:${signatures[signatureIndex]!}`),
            selected.key,
            selected.value,
            key,
            pass,
            existing
          );
        }
      } else {
        const start = bestGroup === 0 ? 0 : valueGroupEnds[bestGroup - 1]!;
        const end = valueGroupEnds[bestGroup]!;
        for (let signatureIndex = start; signatureIndex < end; signatureIndex += 1) {
          existing = this.scanPairBucket(
            this.pairBuckets.get(`pair-value:${valueSignatures[signatureIndex]!}`),
            selected.key,
            selected.value,
            key,
            pass,
            existing
          );
        }
      }
      return existing;
    }
    const signatures = this.signatures ??= [];
    const groupEnds = this.groupEnds ??= [];
    const fallbackSignatures = this.fallbackSignatures ??= [];
    this.writePlan(key, signatures, groupEnds, fallbackSignatures);
    for (let index = 0; index < fallbackSignatures.length; index += 1) {
      existing = this.scanBucket(
        this.buckets!.get(fallbackSignatures[index]!),
        key,
        pass,
        existing
      );
    }
    let bestStart = 0;
    let bestEnd = 0;
    let smallest = Number.POSITIVE_INFINITY;
    let start = 0;
    for (let group = 0; group < groupEnds.length; group += 1) {
      const end = groupEnds[group]!;
      let candidates = 0;
      for (let index = start; index < end; index += 1) {
        const bucket = this.buckets!.get(signatures[index]!);
        candidates += typeof bucket === 'number' ? 1 : bucket?.size ?? 0;
      }
      if (candidates > 0 && candidates < smallest) {
        smallest = candidates;
        bestStart = start;
        bestEnd = end;
      } else if (candidates === 0) {
        return existing;
      }
      start = end;
    }
    if (smallest === Number.POSITIVE_INFINITY) {
      return -1;
    }
    for (let index = bestStart; index < bestEnd; index += 1) {
      existing = this.scanBucket(this.buckets!.get(signatures[index]!), key, pass, existing);
    }
    return existing;
  }

  get(key: ValueGroup): T | undefined {
    if (this.keys.length < 2) {
      return this.keys.length === 1 && compare(SASS_EQUAL, this.keys[0]!, key)
        ? this.items[0]
        : undefined;
    }
    this.ensureIndex();
    const index = this.indexOf(key);
    return index < 0 ? undefined : this.items[index];
  }

  /** Set one key. Returns `true` when appended and `false` when replaced. */
  set(key: ValueGroup, item: T, merge?: (current: T, incoming: T) => T): boolean {
    if (this.keys.length < 2) {
      if (this.keys.length === 1 && compare(SASS_EQUAL, this.keys[0]!, key)) {
        this.items[0] = merge === undefined ? item : merge(this.items[0]!, item);
        this.keys[0] = key;
        return false;
      }
      this.items.push(item);
      this.keys.push(key);
      return true;
    }
    this.ensureIndex();
    const existing = this.indexOf(key);

    if (existing >= 0) {
      this.unindexKey(this.keys[existing]!, existing);
      this.items[existing] = merge === undefined ? item : merge(this.items[existing]!, item);
      this.keys[existing] = key;
      this.indexKey(key, existing);
      return false;
    }

    const index = this.items.length;
    this.items.push(item);
    this.keys.push(key);
    this.indexKey(key, index);
    return true;
  }
}

/** Narrow a value group to a map. */
export function isCollection(value: ValueGroup | undefined): value is Collection {
  return value !== undefined && !isValueGroupArray(value) && value.type === 'Collection';
}

/**
 * A value's map entries in authored order; `[]` for anything that is not a map.
 * Sass reads an EMPTY LIST as an empty map, and that falls out of this contract
 * without a second empty-map representation.
 */
export function collectionEntries(value: ValueGroup | undefined): readonly CollectionEntry[] {
  return isCollection(value) ? value.entries : [];
}

/**
 * Find a map entry by KEY IDENTITY in an already-owned entry list.
 *
 * Sass map keys use SASS EQUALITY — quoting does not distinguish `"a"` from `a`,
 * but a unit does distinguish `1px` from `1` — so this names that primitive
 * outright instead of defaulting a mode nobody at the call sites ever passed.
 */
export function collectionEntryIndex(entries: readonly CollectionEntry[], key: ValueGroup): number {
  for (let index = 0; index < entries.length; index += 1) {
    if (compare(SASS_EQUAL, entries[index]!.key, key)) {
      return index;
    }
  }
  return -1;
}

/**
 * The index of the entry whose key equals `key`, or `-1`.
 *
 * Every map operation is built from this one primitive: `get` reads the entry,
 * `has-key` tests the sign, `set` replaces in place (preserving order) or appends,
 * `remove` splices. Sass compares map keys with Sass equality, so quoting does not
 * distinguish `"a"` from `a`.
 */
export function collectionKeyIndex(value: ValueGroup | undefined, key: ValueGroup): number {
  return collectionEntryIndex(collectionEntries(value), key);
}
