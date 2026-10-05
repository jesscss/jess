import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import { getConfig } from '../../src/config.js';
import {
  decodeSourceMapMappings,
  mappingKind,
  resolveLessTestDataRoot,
  tokenAt,
  upstreamHarnessSourceMap
} from '../test-utils.js';

/*
 * The corpus `sourcemaps*` fixtures, checked the way upstream less.js checks
 * them (`packages/less/test/index.js` → `less-test.js` `testSourcemap`,
 * `testEmptySourcemap`, `testSourcemapWithoutUrlAnnotation`,
 * `testSourcemapWithVariableInSelector`), against the expected maps upstream
 * keeps beside that harness (`packages/less/test/sourcemaps*`).
 *
 * Upstream compares the map JSON byte-for-byte. Here the comparison is
 * semantic — a map is a function from generated positions to authored ones, and
 * Less 4.x writes one segment per emitted chunk where jess writes one per node,
 * so two correct maps differ in bytes. What must agree:
 *   - `file`, `sources` and `sourcesContent`, exactly (path-variant fixtures);
 *   - every mapping holds at its exact generated and authored columns: the same
 *     token on both sides, or one of the named kinds in `mappingKind` (a computed
 *     value mapped to the expression that produced it, a flattened header mapped
 *     to the rule that owns it), each judged at both columns;
 *   - where the CSS is byte-identical to the golden, every line Less 4.x maps
 *     is mapped by jess too, to an authored line Less 4.x also attributes to it.
 *
 * Not compared: the second and later lines of a multi-line selector header
 * (`.a,\n.b {`). Less 4.x maps every selector component to its own source;
 * jess maps a header once, to the rule that owns it.
 *
 * Several expected maps predate the move of the fixtures into `tests-config/`;
 * their paths still name the old layout, so for those (`layout: 'legacy'`) only
 * the file names in `sources`/`file` are compared.
 */

const testData = resolveLessTestDataRoot();
const upstreamTestDir = path.resolve(testData, '../less/test');

type Fixture = {
  file: string;
  kind: 'map' | 'empty' | 'no-annotation' | 'variable-selector';
  expected?: string;
  layout?: 'current' | 'legacy';

  /**
   * The golden's `sourceMappingURL` names a path the fixture's config does not
   * yield, so only the CSS before the annotation is compared to it.
   */
  annotationUnresolved?: true;
};

const fixtures: Fixture[] = [
  { file: 'tests-config/sourcemaps/basic.less', kind: 'map', expected: 'sourcemaps/basic.json', layout: 'legacy' },
  { file: 'tests-config/sourcemaps/custom-props.less', kind: 'map', expected: 'sourcemaps/custom-props.json', layout: 'legacy' },

  /*
   * Its golden's annotation names `tests-config/sourcemaps-comprehensive/`; the
   * fixture lives in `tests-config/sourcemaps/comprehensive/` and its config is
   * `sourceMap: true`, which annotates `comprehensive.css.map`. The golden
   * correction is proposed on the less.js fork branch
   * `lane/v5-sourcemap-comprehensive-golden`; once it lands, drop
   * `annotationUnresolved` here and the `all-less` skip.
   */
  { file: 'tests-config/sourcemaps/comprehensive/comprehensive.less', kind: 'map', expected: 'sourcemaps/comprehensive.json', layout: 'current', annotationUnresolved: true },
  { file: 'tests-config/sourcemaps-url/sourcemaps-url.less', kind: 'map', expected: 'sourcemaps/sourcemaps-url.json', layout: 'current' },
  { file: 'tests-config/sourcemaps-rootpath/sourcemaps-rootpath.less', kind: 'map', expected: 'sourcemaps/sourcemaps-rootpath.json', layout: 'current' },
  { file: 'tests-config/sourcemaps-basepath/sourcemaps-basepath.less', kind: 'map', expected: 'sourcemaps/sourcemaps-basepath.json', layout: 'current' },
  { file: 'tests-config/sourcemaps-include-source/sourcemaps-include-source.less', kind: 'map', expected: 'sourcemaps/sourcemaps-include-source.json', layout: 'current' },
  { file: 'tests-config/sourcemaps-disable-annotation/basic.less', kind: 'no-annotation', expected: 'sourcemaps-disable-annotation/basic.json', layout: 'legacy' },
  { file: 'tests-config/sourcemaps-variable-selector/basic.less', kind: 'variable-selector', expected: 'sourcemaps-variable-selector/basic.json', layout: 'legacy' },
  { file: 'tests-config/sourcemaps-empty/empty.less', kind: 'empty' },
  { file: 'tests-config/sourcemaps-empty/var-defs.less', kind: 'empty' }
];

const ANNOTATION = /\/\*# sourceMappingURL=([^*]*) \*\/$/;

type V3Map = {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  mappings: string;
};

/*
 * Real paths: a config's `require.resolve` (sourcemaps-basepath) yields one, and
 * `sourceMapBasepath` only strips a matching prefix.
 */
const fixturePath = (file: string): string => realpathSync(path.join(testData, file));

async function renderFixture(file: string) {
  const lessPath = fixturePath(file);
  const config = getConfig(path.dirname(lessPath));
  const sourceMap = upstreamHarnessSourceMap(file, config.language?.less?.sourceMap);
  const compiler = new Compiler({
    ...config,
    output: {
      collapseNesting: true, // the corpus default (test-data/styles.config.ts)
      ...(config.output ?? {}),
      ...(sourceMap === undefined ? {} : { sourceMap })
    }
  });
  return compiler.renderToResult(lessPath, {});
}

/** Generated line → the authored `source:line` keys a map attributes to it. */
function attributionsByLine(map: V3Map): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const [genLine, , src, line] of decodeSourceMapMappings(map.mappings)) {
    let keys = out.get(genLine!);
    if (keys === undefined) {
      keys = new Set();
      out.set(genLine!, keys);
    }
    keys.add(`${path.basename(map.sources[src!]!)}:${line}`);
  }
  return out;
}

/** Every mapping holds at its exact generated and authored columns (see `mappingKind`). */
function checkRoundTrip(body: string, map: V3Map, lessDir: string): void {
  const genLines = body.split('\n');
  const sourceLines = map.sources.map(source => readFileSync(path.join(lessDir, path.basename(source)), 'utf8').split('\n'));
  const segments = decodeSourceMapMappings(map.mappings);
  expect(segments.length).toBeGreaterThan(0);
  for (const [genLine, genCol, src, line, col] of segments) {
    const lines = sourceLines[src!];
    expect(lines, `mapping names source #${src}`).toBeDefined();
    expect(line! >= 0 && line! < lines!.length && col! >= 0, `mapped ${line}:${col} is inside its source`).toBe(true);
    const gen = genLines[genLine!] ?? '';
    const authored = lines![line!]!;
    expect(
      mappingKind(gen, genCol!, authored, col!),
      `gen ${genLine! + 1}:${genCol} "${tokenAt(gen, genCol!)}" does not map to ${map.sources[src!]} ${line! + 1}:${col} "${tokenAt(authored, col!)}"`
    ).toBeDefined();
  }
}

function checkMap(fixture: Fixture, css: string, mapJson: string): void {
  const lessDir = path.dirname(fixturePath(fixture.file));
  const map = JSON.parse(mapJson) as V3Map;
  const expected = JSON.parse(readFileSync(path.join(upstreamTestDir, fixture.expected!), 'utf8')) as V3Map;
  expect(map.version).toBe(3);

  if (fixture.layout === 'current') {
    expect(map.file).toBe(expected.file);
    expect(map.sources).toEqual(expected.sources);
    if (expected.sourcesContent !== undefined) {
      expect(map.sourcesContent).toEqual(expected.sourcesContent);
    }
  } else {
    expect(path.basename(map.file ?? '')).toBe(path.basename(expected.file ?? ''));
    expect(map.sources.map(source => path.basename(source))).toEqual(expected.sources.map(source => path.basename(source)));
  }

  const body = css.replace(ANNOTATION, '');
  const genLines = body.split('\n');
  checkRoundTrip(body, map, lessDir);

  /* Line attribution against Less 4.x, where the CSS is the golden's. */
  const golden = path.join(lessDir, `${path.basename(fixture.file, '.less')}.css`);
  if (!existsSync(golden) || readFileSync(golden, 'utf8').replace(ANNOTATION, '') !== body) {
    return;
  }
  const ours = attributionsByLine(map);
  const theirs = attributionsByLine(expected);
  let compared = 0;
  genLines.forEach((text, index) => {
    const continuation = index > 0 && genLines[index - 1]!.trimEnd().endsWith(',');
    const wanted = theirs.get(index);
    if (continuation || wanted === undefined || text.trim() === '') {
      return;
    }
    compared++;
    const got = ours.get(index);
    expect(got, `line ${index + 1} ${JSON.stringify(text)} is unmapped`).toBeDefined();
    for (const key of got!) {
      expect(wanted.has(key), `line ${index + 1} ${JSON.stringify(text)} maps to ${key}; Less 4.x: ${[...wanted].join(', ')}`).toBe(true);
    }
  });
  expect(compared, 'lines compared against Less 4.x').toBeGreaterThan(0);
}

describe('Less source-map fixtures', () => {
  it('finds the upstream expected maps', () => {
    expect(existsSync(path.join(upstreamTestDir, 'sourcemaps/basic.json')), `expected maps live in ${upstreamTestDir}`).toBe(true);
  });

  for (const fixture of fixtures) {
    it(fixture.file, async () => {
      const result = await renderFixture(fixture.file);
      expect(result.errors).toEqual([]);

      if (fixture.kind === 'empty') {
        expect(result.css).toBe('');
        expect(result.map).toBeUndefined();
        return;
      }
      expect(result.map).toBeTypeOf('string');

      const annotation = ANNOTATION.exec(result.css);
      if (fixture.kind === 'map') {
        expect(annotation?.[1], 'sourceMappingURL annotation').toBeTruthy();
      }
      if (fixture.kind === 'no-annotation') {
        /* Any trailing annotation, `data:` URIs included; the fixture authors one inside a rule. */
        expect(result.css).not.toMatch(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/);
      }

      const golden = path.join(testData, fixture.file.replace(/\.less$/, '.css'));
      if (existsSync(golden)) {
        const goldenCss = readFileSync(golden, 'utf8');
        if (fixture.annotationUnresolved) {
          expect(result.css.replace(ANNOTATION, '')).toBe(goldenCss.replace(ANNOTATION, ''));
        } else {
          expect(result.css).toBe(goldenCss);
        }
      }
      checkMap(fixture, result.css, result.map!);
    });
  }
});

/*
 * Compressed output writes whole rules on one line; its map must still point
 * every token at its authored place. The compression fixtures carry no map
 * expectations upstream, so only the round trip is checked.
 */
describe('Less compression fixtures with a source map', () => {
  for (const file of [
    'tests-config/compression/compression.less',
    'tests-config/at-rules-compressed/at-rules-compressed.less',
    'tests-config/at-rules-compressed-evaluation/at-rules-compressed-evaluation.less'
  ]) {
    it(file, async () => {
      const lessPath = fixturePath(file);
      const config = getConfig(path.dirname(lessPath));
      const result = await new Compiler({
        ...config,
        output: { collapseNesting: true, ...(config.output ?? {}), sourceMap: true }
      }).renderToResult(lessPath, {});
      expect(result.errors).toEqual([]);
      const golden = readFileSync(lessPath.replace(/\.less$/, '.css'), 'utf8');
      expect(result.css).toBe(`${golden}/*# sourceMappingURL=${path.basename(file, '.less')}.css.map */`);
      checkRoundTrip(golden, JSON.parse(result.map!) as V3Map, path.dirname(lessPath));
    });
  }
});
