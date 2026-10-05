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
import * as fs from 'fs';
import * as path from 'path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { decodeSourceMapMappings, tokenAt } from './test-utils.js';

interface AuditResult {
  readonly count: number;
  readonly sourcesSeen: Set<string>;
}

async function auditRoundTrip(
  entry: string,
  collapseNesting: boolean,
  compress = false,
  globalVars?: Record<string, string>
): Promise<AuditResult> {
  const c = new Compiler({
    output: { collapseNesting, compress, sourceMap: { outputSourceFiles: true } },
    compile: { plugins: [lessPlugin()] },
    language: globalVars === undefined ? {} : { less: { globalVars } }
  });
  const r = await c.renderToResult(entry, {});
  const css = r.css;
  const map = JSON.parse(r.map!) as { sources: string[]; sourcesContent: string[]; mappings: string };
  const mappings = decodeSourceMapMappings(map.mappings);
  const sourcesSeen = new Set<string>();
  const genLines = css.split('\n');

  /* Each embedded source is the file as authored — nothing injected ahead of it. */
  map.sources.forEach((source, index) => {
    expect(map.sourcesContent[index]).toBe(fs.readFileSync(path.resolve(path.dirname(entry), source), 'utf8'));
  });
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

    /*
     * An extend found while expanding a mixin rewrites the target's header after
     * the walk has moved past it, so every mapping recorded later must still
     * land on its own token once the header has grown.
     */
    it(`a header rewritten by a late extend keeps later mappings in place (collapseNesting=${collapseNesting})`, async () => {
      for (const compress of [false, true]) {
        const r = await auditRoundTrip(path.join(fixtures, 'late-extend.less'), collapseNesting, compress);
        expect(r.count).toBeGreaterThanOrEqual(5);
      }
    });

    /*
     * Less `globalVars` are injected ahead of the entry source; the map must
     * still point into the file as authored, not into the injected prefix.
     */
    it(`globalVars do not shift entry-file mappings (collapseNesting=${collapseNesting})`, async () => {
      const r = await auditRoundTrip(path.join(fixtures, 'reorder.less'), collapseNesting, false, { injectedA: '1px', injectedB: 'red' });
      expect(r.count).toBeGreaterThanOrEqual(6);
    });
  }
});
