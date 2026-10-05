/**
 * MATHEMATICAL correctness audit for source-map generation: decode the emitted
 * v3 map with a self-contained base64-VLQ decoder (independent of the encoder)
 * and assert that EVERY mapping holds at its exact generated and authored
 * columns — the round-trip that defines a correct source map (`mappingKind`).
 *
 * Covers the hard cases where OUTPUT order != SOURCE order, so a mapping proves
 * itself only by pointing a moved output token back to its authored location:
 *   - multi-file (`@import`) attribution, including an `(inline)` import;
 *   - hoisted `@charset` (source line 4 -> output line 1);
 *   - a bubbled `@media` (nested in source, emitted at root);
 *   - nested selectors, audited in BOTH `collapseNesting` modes (flattened vs
 *     nested output — different generated positions, same source tokens);
 *   - text a host injects ahead of the entry file, and output blanked after
 *     the walk.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Compiler } from '../src/index.js';
import { Compiler as BaseCompiler, type ConfigOptions } from '@jesscss/compiler';
import { defineFunction, makeAny, makeDimension, makeNull } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { decodeSourceMapMappings, mappingKind, tokenAt } from './test-utils.js';

interface AuditResult {
  readonly css: string;
  readonly count: number;
  readonly sourcesSeen: Set<string>;
}

type Rendered = { css: string; map?: string };

function audit(entry: string, r: Rendered): AuditResult {
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
    const srcLines = (map.sourcesContent[si!] ?? '').split('\n');
    expect(sl! >= 0 && sl! < srcLines.length && sc! >= 0, `mapped ${sl}:${sc} is inside ${map.sources[si!]}`).toBe(true);
    const gen = genLines[gl!] ?? '';
    const src = srcLines[sl!]!;
    expect(
      mappingKind(gen, gc!, src, sc!),
      `${path.basename(entry)}: gen(${gl! + 1}:${gc}) "${tokenAt(gen, gc!)}" (line: ${JSON.stringify(gen)}) does not map to ${path.basename(map.sources[si!]!)}(${sl! + 1}:${sc}) "${tokenAt(src, sc!)}"`
    ).toBeDefined();
    sourcesSeen.add(path.basename(map.sources[si!]!));
  }
  return { css, count: mappings.length, sourcesSeen };
}

async function auditRoundTrip(
  entry: string,
  collapseNesting: boolean,
  compress = false,
  less: Record<string, unknown> = {}
): Promise<AuditResult> {
  const c = new Compiler({
    output: { collapseNesting, compress, sourceMap: { outputSourceFiles: true } },
    compile: { plugins: [lessPlugin()] },
    language: { less }
  });
  return audit(entry, await c.renderToResult(entry, {}));
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
     * exact-column check must still hold with `{ compress: true }`, where every
     * rule shares one generated line.
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
     * Less `globalVars` and `banner` are injected ahead of the entry source and
     * `modifyVars` after it; the map must still point into the file as authored,
     * and embed it as authored. The banner is emitted but has no authored home,
     * so it is left unmapped rather than pointed at line 1.
     */
    it(`injected globalVars, modifyVars and banner do not shift entry-file mappings (collapseNesting=${collapseNesting})`, async () => {
      const entry = path.join(fixtures, 'reorder.less');
      const vars = await auditRoundTrip(entry, collapseNesting, false, {
        globalVars: { injectedA: '1px', injectedB: 'red' },
        modifyVars: { injectedC: '2px' }
      });
      expect(vars.count).toBeGreaterThanOrEqual(6);
      for (const compress of [false, true]) {
        const banner = await auditRoundTrip(entry, collapseNesting, compress, { banner: '/*! injected banner */', globalVars: { injectedA: '1px' } });
        expect(banner.css).toContain('/*! injected banner */');
        expect(banner.count).toBeGreaterThanOrEqual(6);
      }
    });
  }

  /*
   * A host `prepareSource` hook may inject text that does not end in a line
   * break, so the entry's first line is shifted sideways as well as down. A
   * rule it injects is emitted, but has no authored home and stays unmapped.
   */
  it('maps the entry first line under a same-line injected prefix', async () => {
    const entry = path.join(fixtures, 'reorder.less');
    const prefix = '.host { x: 1 } ';
    const config: ConfigOptions = {
      output: { collapseNesting: true, sourceMap: { outputSourceFiles: true } },
      compile: { plugins: [lessPlugin()] },
      language: {}
    };
    const compiler = new BaseCompiler(config, {
      prepareSource: source => ({ source: `${prefix}${source}`, sourceOffset: prefix.length })
    });
    const r = audit(entry, await compiler.renderToResult(entry, {}));
    expect(r.css).toContain('.host {');
    expect(r.count).toBeGreaterThanOrEqual(6);
  });

  /*
   * `(inline)` splices the file's text; each spliced line maps to its own line
   * in that file. The `?query` is part of the URL, not of the file name.
   */
  it('maps an (inline) import line by line, query string and all', async () => {
    for (const compress of [false, true]) {
      const r = await auditRoundTrip(path.join(fixtures, 'inline-entry.less'), true, compress);
      expect(r.css).toContain('.inlined');
      expect(r.sourcesSeen.has('inline.css')).toBe(true);
      expect(r.sourcesSeen.has('inline-entry.less')).toBe(true);
    }
  });

  /*
   * A declaration whose awaited value is null is blanked after the walk; it
   * emitted nothing, so it must not leave a mapping on the next declaration.
   */
  it('leaves no mapping for a declaration blanked after the walk', async () => {
    const asyncNull = defineFunction('anull', {
      variadic: true,
      params: [],
      body: async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return makeNull();
      }
    });
    const entry = path.join(fixtures, 'async-null.less');
    for (const compress of [false, true]) {
      const c = new Compiler({
        output: { collapseNesting: true, compress, sourceMap: { outputSourceFiles: true } },
        compile: { plugins: [lessPlugin(), lessCompatPlugin({ functions: [asyncNull] })] }
      });
      const r = audit(entry, await c.renderToResult(entry, {}));
      expect(r.css).not.toContain('gone');
      expect(r.css).toContain('kept');
    }
  });

  /*
   * A declaration value and a custom property value whose bytes settle after
   * the walk each fill a chunk reserved in source order, so each is mapped over
   * that chunk: at its settled bytes, to its authored start. A statement call
   * settles where it stands in the walk, and is mapped like any written leaf.
   */
  it('maps every slot that settles asynchronously at its settled bytes', async () => {
    const settle = async <T>(value: T): Promise<T> => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return value;
    };
    const adim = defineFunction('adim', { params: [], body: () => settle(makeDimension(2, 'px')) });
    const astmt = defineFunction('astmt', { params: [], body: () => settle(makeAny('/* from astmt */')) });
    const entry = path.join(fixtures, 'async-slots.less');
    for (const collapseNesting of [true, false]) {
      for (const compress of [false, true]) {
        const c = new Compiler({
          output: { collapseNesting, compress, sourceMap: { outputSourceFiles: true } },
          compile: { plugins: [lessPlugin(), lessCompatPlugin({ functions: [adim, astmt] })] }
        });
        const r = await c.renderToResult(entry, {});
        const map = JSON.parse(r.map!) as { mappings: string };
        const mappings = decodeSourceMapMappings(map.mappings);
        const lines = r.css.split('\n');

        /*
         * The authored [line, column] mapped at the first `text` after `after`.
         * A mapping at a line's indent covers the token after it (`tokenAt`).
         */
        const origin = (text: string, after: string): number[] | undefined => {
          const line = lines.findIndex(l => l.includes(after) && l.includes(text, l.indexOf(after)));
          let column = lines[line]!.indexOf(text, lines[line]!.indexOf(after));
          if (/^\s*$/u.test(lines[line]!.slice(0, column))) {
            column = 0;
          }
          return mappings.find(([gl, gc]) => gl === line && gc === column)?.slice(3);
        };
        const label = `collapseNesting=${collapseNesting} compress=${compress}`;
        expect(r.css, label).not.toContain('adim');
        expect(origin('2px', 'width'), label).toEqual([2, 9]);
        expect(origin('2px y', '--x'), label).toEqual([3, 7]);
        expect(origin('/* from astmt */', '/* from astmt */'), label).toEqual([4, 2]);
        expect(origin('2px', 'height'), label).toEqual([8, 10]);
      }
    }
  });
});
