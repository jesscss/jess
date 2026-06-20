/**
 * Field names whose source ranges can be tracked without wrapping string values.
 *
 * The table is intentionally small and dense: nodes keep ergonomic string
 * payloads elsewhere, while this side table carries source offsets and coarse
 * segment kinds for diagnostics, source maps, and later JIT parsing.
 */
export type FieldRangeName = 'body' | 'name' | 'prelude' | 'selector' | 'value';

/** Coarse segment kind used by scanner-first metadata before typed parsing. */
export type FieldRangeKind =
  | 'at-rule-name'
  | 'body-text'
  | 'declaration-name'
  | 'import-name'
  | 'mixin-name'
  | 'prelude'
  | 'selector'
  | 'value';

/** Readable range returned by cold metadata queries. */
export type FieldRange = {
  readonly field: FieldRangeName;
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly kind: FieldRangeKind;
};

/** Read-only field-range queries exposed from parsed structural documents. */
export type ReadonlyFieldRangeTable<NodeKey extends object = object> = {
  readonly size: number;
  get(node: NodeKey, field: FieldRangeName, index?: number): FieldRange | undefined;
  rangesFor(node: NodeKey, field?: FieldRangeName): readonly FieldRange[];
};

/**
 * Dense side table for source ranges keyed by owning node, field, and segment.
 *
 * This avoids allocating `{ start, end, kind }` objects on every structural node
 * while preserving exact source identity for string payloads. Query methods are
 * cold and allocate readable objects only for callers that request metadata.
 */
export class FieldRangeTable<NodeKey extends object = object> {
  readonly #nodes: NodeKey[] = [];
  readonly #fields: number[] = [];
  readonly #kinds: number[] = [];
  readonly #indexes: number[] = [];
  readonly #starts: number[] = [];
  readonly #ends: number[] = [];

  /** Number of stored field segments. */
  get size(): number {
    return this.#starts.length;
  }

  /** Adds one source-backed string segment for `node.field[index]`. */
  add(
    node: NodeKey,
    field: FieldRangeName,
    index: number,
    start: number,
    end: number,
    kind: FieldRangeKind
  ): void {
    this.#nodes.push(node);
    this.#fields.push(fieldToCode(field));
    this.#indexes.push(index);
    this.#starts.push(start);
    this.#ends.push(end);
    this.#kinds.push(kindToCode(kind));
  }

  /** Returns the exact segment metadata for `node.field[index]`, if present. */
  get(node: NodeKey, field: FieldRangeName, index = 0): FieldRange | undefined {
    const fieldCode = fieldToCode(field);
    for (let i = 0; i < this.#starts.length; i++) {
      if (this.#nodes[i] === node && this.#fields[i] === fieldCode && this.#indexes[i] === index) {
        return this.#rangeAt(i);
      }
    }
    return undefined;
  }

  /** Returns every segment recorded for a node, optionally filtered by field. */
  rangesFor(node: NodeKey, field?: FieldRangeName): readonly FieldRange[] {
    const ranges: FieldRange[] = [];
    const fieldCode = field === undefined ? undefined : fieldToCode(field);
    for (let i = 0; i < this.#starts.length; i++) {
      if (this.#nodes[i] === node && (fieldCode === undefined || this.#fields[i] === fieldCode)) {
        ranges.push(this.#rangeAt(i));
      }
    }
    return ranges;
  }

  #rangeAt(index: number): FieldRange {
    return {
      field: codeToField(this.#fields[index]!),
      index: this.#indexes[index]!,
      start: this.#starts[index]!,
      end: this.#ends[index]!,
      kind: codeToKind(this.#kinds[index]!)
    };
  }
}

const FIELD_CODES = {
  body: 0,
  name: 1,
  prelude: 2,
  selector: 3,
  value: 4
} as const satisfies Record<FieldRangeName, number>;

const FIELDS_BY_CODE = ['body', 'name', 'prelude', 'selector', 'value'] as const satisfies readonly FieldRangeName[];

const KINDS_BY_CODE = [
  'at-rule-name',
  'body-text',
  'declaration-name',
  'import-name',
  'mixin-name',
  'prelude',
  'selector',
  'value'
] as const satisfies readonly FieldRangeKind[];

function fieldToCode(field: FieldRangeName): number {
  return FIELD_CODES[field];
}

function kindToCode(kind: FieldRangeKind): number {
  switch (kind) {
    case 'at-rule-name':
      return 0;
    case 'body-text':
      return 1;
    case 'declaration-name':
      return 2;
    case 'import-name':
      return 3;
    case 'mixin-name':
      return 4;
    case 'prelude':
      return 5;
    case 'selector':
      return 6;
    case 'value':
      return 7;
  }
}

function codeToField(code: number): FieldRangeName {
  const field = FIELDS_BY_CODE[code];
  if (field === undefined) {
    throw new RangeError(`Unknown field range code ${code}.`);
  }
  return field;
}

function codeToKind(code: number): FieldRangeKind {
  const kind = KINDS_BY_CODE[code];
  if (kind === undefined) {
    throw new RangeError(`Unknown field range kind code ${code}.`);
  }
  return kind;
}
