/**
 * Test-only AST shape probe for the V8 shape-stability gate.
 *
 * Walks freshly parsed canonical-AST documents and records, per node `type`, the
 * set of own-property key shapes seen (ordered `Object.keys` join). A `type` with
 * more than one shape means V8 keeps multiple hidden classes for it, so keyed
 * stores into those nodes go megamorphic — a cost byte-identity and wall-time
 * cannot see. No production code imports this module.
 */

export type ShapeMap = Map<string, Set<string>>;

export interface CorpusSource {
  readonly label: string;
  readonly text: string;
  /**
   * Parser options for this source. Some node types are only reachable under a
   * non-default policy — `$apply` defaults to `allowApplySelectors: ['class']`,
   * so an id/attribute/pseudo target is REJECTED unless the kinds are widened.
   * Threading options keeps those shapes in the gate instead of quietly
   * narrowing the corpus to whatever happens to parse under defaults.
   */
  readonly options?: Readonly<Record<string, unknown>>;
}

interface Corpus {
  readonly name: string;
  readonly parse: (input: string, options?: Readonly<Record<string, unknown>>) => object;
  readonly sources: readonly CorpusSource[];
}

export interface CollectResult {
  readonly shapes: ShapeMap;
  /** Snippets that failed to parse (only populated when `tolerant`). */
  readonly failures: { readonly dialect: string; readonly label: string; readonly message: string }[];
}

/**
 * Own enumerable key order is the truest proxy for a V8 hidden class: two
 * construction sites emitting the same keys in a different order still land on
 * different hidden classes. We therefore key the signature on the raw
 * `Object.keys` order, not a sorted set.
 */
const shapeOf = (node: object): string => Object.keys(node).join(',');

const isPlainNode = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Record the shape of `node`, then recurse into every object/array child. */
const walk = (value: unknown, shapes: ShapeMap, seen: WeakSet<object>): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, shapes, seen);
    }
    return;
  }
  if (!isPlainNode(value)) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  const type = value['type'];
  if (typeof type === 'string') {
    let set = shapes.get(type);
    if (set === undefined) {
      set = new Set<string>();
      shapes.set(type, set);
    }
    set.add(shapeOf(value));
  }

  for (const key of Object.keys(value)) {
    walk(value[key], shapes, seen);
  }
};

/**
 * Parse every corpus source and fold all node shapes into one map.
 *
 * `tolerant` (discovery) records parse failures instead of throwing, so a broad
 * exploratory corpus can be pruned to the known-good gate set. The gate run uses
 * `tolerant: false`: any parse failure is a hard error (the curated corpus must
 * parse cleanly on every supported dialect).
 */
export function collectShapes(corpora: readonly Corpus[], tolerant = false): CollectResult {
  const shapes: ShapeMap = new Map();
  const failures: CollectResult['failures'] = [];
  for (const corpus of corpora) {
    for (const source of corpus.sources) {
      let doc: object;
      try {
        doc = corpus.parse(source.text, source.options);
      } catch (error) {
        const message = (error as Error).message;
        if (tolerant) {
          failures.push({ dialect: corpus.name, label: source.label, message });
          continue;
        }
        throw new Error(
          `[${corpus.name}:${source.label}] corpus source failed to parse: ${message}\n`
          + `--- source ---\n${source.text.slice(0, 400)}`
        );
      }
      // A fresh WeakSet per document: shared node identities within one parse are
      // recorded once, but the same shape reappearing across documents is fine
      // (it folds into the same Set entry).
      walk(doc, shapes, new WeakSet<object>());
    }
  }
  return { shapes, failures };
}

/** Human-readable inventory for the discovery run (SHAPE_DISCOVER=true). */
export function formatShapeReport(result: CollectResult): string {
  const { shapes, failures } = result;
  const lines: string[] = [`\n=== AST shape inventory (${shapes.size} types) ===`];
  if (failures.length > 0) {
    lines.push(`\n--- ${failures.length} corpus parse FAILURES (prune from gate corpus) ---`);
    for (const f of failures) {
      lines.push(`  [${f.dialect}:${f.label}] ${f.message}`);
    }
    lines.push('');
  }
  const poly: string[] = [];
  for (const type of [...shapes.keys()].sort()) {
    const set = shapes.get(type)!;
    const tag = set.size > 1 ? '  <== POLYMORPHIC' : '';
    lines.push(`${type} (${set.size})${tag}`);
    for (const sig of set) {
      lines.push(`    [${sig}]`);
    }
    if (set.size > 1) {
      poly.push(type);
    }
  }
  lines.push(`\n=== ${poly.length} polymorphic types: ${poly.join(', ') || '(none)'} ===`);
  return lines.join('\n');
}

/**
 * Recorded shape-debt inventory: node types that are polymorphic on TODAY's dev,
 * with the exact shapes tolerated. The gate passes on these but fails on any NEW
 * shape (see shape-stability.test.ts). Empty === no known debt; every new entry
 * is a Phase-B monomorphization candidate, NOT a fix to make here.
 *
 * Format: type -> the exact `Object.keys().join(',')` signatures allowed.
 */
export const SHAPE_DEBT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  // Each polymorphic type below diverges purely on an OPTIONAL trailing field
  // that some construction sites omit. Every entry is a Phase-B monomorphization
  // candidate (give the node a stable full shape — e.g. `guard: null` — at every
  // construction site) so the field is always present and V8 keeps one hidden
  // class. Do NOT fix here; this gate only prevents NEW divergence and any WORSE
  // (third) shape.

  // Signatures include the inline provenance slots (`_s`/`_e`, plus `_bs`/`_be`
  // for block-bearing types) introduced by 39a9ca346. They are written
  // unconditionally by every factory, so they are part of the signature but add
  // no divergence — verified: each arm below carries the identical slot tail.

  // TODO(shape-debt): MixinDefinition omits `guard` for unguarded definitions.
  MixinDefinition: [
    'type,name,params,rules,_s,_e,_bs,_be',
    'type,name,params,rules,guard,_s,_e,_bs,_be'
  ],

  // TODO(shape-debt): Ruleset omits `extendInstructions` unless the rule carries
  // an inline `:extend()` / `&:extend()`. `rule()` in ast/nodes.ts has TWO
  // independent conditional spreads (`extendInstructions`, `guard`), so it can
  // author FOUR arms; this corpus realizes two. The other two are unreachable
  // here only because no source combines a guard with a ruleset.
  Ruleset: [
    'type,selector,rules,_s,_e,_bs,_be',
    'type,selector,rules,extendInstructions,_s,_e,_bs,_be'
  ],

  // TODO(shape-debt): SpacedValue omits `separators` when no authored separator
  // layout is retained.
  SpacedValue: ['type,parts,separators', 'type,parts']
};
