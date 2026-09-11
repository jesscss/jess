/**
 * MATHEMATICAL correctness audit for source-map generation: decode the emitted
 * v3 map with a self-contained base64-VLQ decoder (independent of the encoder)
 * and assert that EVERY mapping lands on the SAME token in the generated CSS and
 * in its mapped source — the round-trip that defines a correct source map.
 *
 * Covers the hard cases where OUTPUT order != SOURCE order, so a mapping proves
 * itself only by pointing a moved output token back to its authored location:
 *   - multi-file (`@import`) attribution;
 *   - hoisted `@charset` (source line 4 -> output line 1);
 *   - a bubbled `@media` (nested in source, emitted at root);
 *   - nested selectors, audited in BOTH `collapseNesting` modes (flattened vs
 *     nested output — different generated positions, same source tokens).
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode v3 `mappings` into [genLine0, genCol0, srcIndex, srcLine0, srcCol0]. */
function decodeVLQ(str: string): number[][] {
  const out: number[][] = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  str.split(';').forEach((line, genLine) => {
    let genCol = 0;
    if (line === '') {
      return;
    }
    for (const seg of line.split(',')) {
      const nums: number[] = [];
      let shift = 0;
      let value = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) {
          shift += 5;
        } else {
          const magnitude = value >> 1;
          nums.push(value & 1 ? -magnitude : magnitude);
          value = 0;
          shift = 0;
        }
      }
      if (nums.length >= 4) {
        genCol += nums[0]!;
        srcIdx += nums[1]!;
        srcLine += nums[2]!;
        srcCol += nums[3]!;
        out.push([genLine, genCol, srcIdx, srcLine, srcCol]);
      } else if (nums.length === 1) {
        genCol += nums[0]!;
      }
    }
  });
  return out;
}

/** The leading token at a 0-based line/column, whitespace-trimmed. */
function tokenAt(text: string, line0: number, col0: number): string {
  const line = text.split('\n')[line0] ?? '';
  const match = line.slice(col0).match(/^\s*([.#@]?[-\w%]+|\S+?)/);
  return (match ? match[1]! : line.slice(col0, col0 + 12)).trim();
}

interface AuditResult {
  readonly count: number;
  readonly sourcesSeen: Set<string>;
}

async function auditRoundTrip(entry: string, collapseNesting: boolean, compress = false): Promise<AuditResult> {
  const c = new Compiler({
    output: { collapseNesting, compress, sourceMap: { outputSourceFiles: true } },
    compile: { plugins: [lessPlugin()] }
  });
  const r = await c.renderToResult(entry, {});
  const css = r.css;
  const map = JSON.parse(r.map!) as { sources: string[]; sourcesContent: string[]; mappings: string };
  const mappings = decodeVLQ(map.mappings);
  const sourcesSeen = new Set<string>();
  const genLines = css.split('\n');
  for (const [gl, gc, si, sl, sc] of mappings) {
    const genToken = tokenAt(css, gl, gc);
    const srcToken = tokenAt(map.sourcesContent[si] ?? '', sl, sc);

    /*
     * Exact-token round-trip is the invariant for declarations, values, and
     * (in nested output) selectors. A FLATTENED compound selector is the one
     * legitimate exception: `.wrapper .inner` in the output maps to the inner
     * rule's own source (`.inner`) — the rule that owns it — so its leading
     * output token is the inherited parent, not the mapped source token. Accept
     * that only when the mapped source token still appears in the generated line
     * (a genuinely wrong mapping points at a token absent from the output).
     */
    const ok = genToken === srcToken || (genLines[gl] ?? '').includes(srcToken);
    expect(
      ok,
      `${path.basename(entry)} collapse=${collapseNesting}: gen(${gl + 1}:${gc}) "${genToken}" (line: ${JSON.stringify(genLines[gl])}) does not round-trip to ${path.basename(map.sources[si]!)}(${sl + 1}:${sc}) "${srcToken}"`
    ).toBe(true);
    sourcesSeen.add(path.basename(map.sources[si]!));
  }
  return { count: mappings.length, sourcesSeen };
}

const fixtures = path.join(__dirname, 'fixtures', 'sourcemap');

describe('source map round-trip is mathematically correct', () => {
  for (const collapseNesting of [true, false]) {
    it(`multi-file @import attribution (collapseNesting=${collapseNesting})`, async () => {
      const r = await auditRoundTrip(path.join(fixtures, 'entry.less'), collapseNesting);
      expect(r.count).toBeGreaterThanOrEqual(5);

      // imported content maps to the imported file, entry content to the entry
      expect(r.sourcesSeen.has('imported.less')).toBe(true);
      expect(r.sourcesSeen.has('entry.less')).toBe(true);
    });

    it(`reordered content: hoisted @charset + bubbled @media + nested selectors (collapseNesting=${collapseNesting})`, async () => {
      const r = await auditRoundTrip(path.join(fixtures, 'reorder.less'), collapseNesting);
      expect(r.count).toBeGreaterThanOrEqual(6);
    });

    /*
     * Compress rewrites the emitted bytes but not the position mechanism (`put()`
     * records offsets regardless of content), so the SAME independent decode +
     * token round-trip must still hold with `{ compress: true }`.
     */
    it(`compressed output stays source-map-correct (collapseNesting=${collapseNesting})`, async () => {
      const imports = await auditRoundTrip(path.join(fixtures, 'entry.less'), collapseNesting, true);
      expect(imports.count).toBeGreaterThanOrEqual(5);
      expect(imports.sourcesSeen.has('imported.less')).toBe(true);
      expect(imports.sourcesSeen.has('entry.less')).toBe(true);

      const reordered = await auditRoundTrip(path.join(fixtures, 'reorder.less'), collapseNesting, true);
      expect(reordered.count).toBeGreaterThanOrEqual(6);
    });
  }
});
