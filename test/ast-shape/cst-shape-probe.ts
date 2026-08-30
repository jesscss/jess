/**
 * Test-only CST shape probe — the CST half of the V8 shape-stability gate.
 *
 * The AST probe keys signatures by node `type` because the AST has ~39 of them.
 * The CST is the opposite: ONE builder (`buildCssCstNode` in css-parser) emits
 * every node for all four dialects, and leaf/span records come from a handful of
 * sites beside it. So the meaningful assertion is not per-`type` but per-KIND —
 * the set of key signatures the node / leaf / span / error families realize,
 * across every dialect, as a NAMED set.
 *
 * That framing is what makes this gate able to catch the `ffe33b15d` hazard: the
 * two-arm branch in `buildCssCstNode` is only safe while both arms stay
 * field-for-field identical apart from `tags`. Adding a field to one arm, or in
 * a different position, mints a third node signature — which shows up here as an
 * unlisted member, with its keys printed, rather than as a count going 2 -> 3.
 */

export type SignatureMap = Map<string, Set<string>>;

export interface CstKindShapes {
  readonly node: SignatureMap;
  readonly leaf: SignatureMap;
  readonly span: SignatureMap;
  readonly error: SignatureMap;
}

export interface CstCorpusEntry {
  readonly label: string;
  readonly parse: (input: string) => { readonly tree: unknown; readonly ok?: boolean };
  readonly text: string;
}

/**
 * Per-source yield, so an empty tree cannot masquerade as coverage.
 *
 * This is not defensive padding. `parseJessCst(benchmark.css)` returns `ok:false`
 * and a 1-node `emptyStyleSheet()` for 123KB of input — it appeared in the
 * signature inventory as a participating dialect while contributing nothing. A
 * source that stops parsing must fail loudly here rather than quietly shrink the
 * surface every signature assertion is drawn from.
 */
export interface CstCorpusYield {
  readonly label: string;
  readonly ok: boolean;
  readonly nodes: number;
  readonly leaves: number;
}

const record = (map: SignatureMap, keys: string, label: string): void => {
  let set = map.get(keys);
  if (set === undefined) {
    set = new Set<string>();
    map.set(keys, set);
  }
  set.add(label);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * Explicit-stack DFS. Do NOT recurse generically over own keys and do NOT
 * `JSON.stringify` a CST: `rules` and `children` are the SAME array under two
 * names, so a naive walk visits every subtree twice per level and exhausts the
 * heap on a real stylesheet. Only `rules` is descended.
 */
export function collectCstShapes(corpus: readonly CstCorpusEntry[]): CstKindShapes & { readonly yields: CstCorpusYield[] } {
  const shapes = {
    node: new Map<string, Set<string>>(),
    leaf: new Map<string, Set<string>>(),
    span: new Map<string, Set<string>>(),
    error: new Map<string, Set<string>>(),
    yields: [] as CstCorpusYield[]
  };

  for (const entry of corpus) {
    const result = entry.parse(entry.text);
    let nodes = 0;
    let leaves = 0;
    const stack: unknown[] = [result.tree];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!isRecord(current)) {
        continue;
      }
      const span = current['span'];
      if (isRecord(span)) {
        record(shapes.span, Object.keys(span).join(','), entry.label);
      }
      const tag = current['_tag'];
      const kind = tag === 'node' ? shapes.node : tag === 'leaf' ? shapes.leaf : shapes.error;
      if (tag === 'node') {
        nodes++;
      } else if (tag === 'leaf') {
        leaves++;
      }
      record(kind, Object.keys(current).join(','), entry.label);

      const rules = current['rules'];
      if (Array.isArray(rules)) {
        for (let i = rules.length - 1; i >= 0; i--) {
          stack.push(rules[i]);
        }
      }
    }
    shapes.yields.push({ label: entry.label, ok: result.ok !== false, nodes, leaves });
  }
  return shapes;
}

/** Human-readable inventory for the discovery run (SHAPE_DISCOVER=true). */
export function formatCstShapeReport(shapes: CstKindShapes & { readonly yields?: readonly CstCorpusYield[] }): string {
  const lines: string[] = ['\n=== CST shape inventory ==='];
  if (shapes.yields !== undefined) {
    lines.push('\nper-source yield:');
    for (const y of shapes.yields) {
      lines.push(`    ${y.label}: ok=${String(y.ok)} nodes=${y.nodes} leaves=${y.leaves}`);
    }
  }
  for (const kind of ['node', 'leaf', 'span', 'error'] as const) {
    const map = shapes[kind];
    lines.push(`\n${kind}: ${map.size} signature(s)`);
    for (const [signature, labels] of map) {
      lines.push(`    [${signature}]`);
      lines.push(`        seen in: ${[...labels].sort().join(', ')}`);
    }
  }
  return lines.join('\n');
}
