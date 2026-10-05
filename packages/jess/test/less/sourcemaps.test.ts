import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import { getConfig } from '../../src/config.js';
import {
  decodeSourceMapMappings,
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
 *   - every mapping round-trips: the generated token and the authored token it
 *     points at are the same token (a flattened selector header may lead with an
 *     inherited parent, so its mapped token only has to appear on the line);
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
   * The golden's `sourceMappingURL` names a path no harness convention yields,
   * so only the CSS before the annotation is compared to it.
   */
  staleGoldenAnnotation?: true;
};

const fixtures: Fixture[] = [
  { file: 'tests-config/sourcemaps/basic.less', kind: 'map', expected: 'sourcemaps/basic.json', layout: 'legacy' },
  { file: 'tests-config/sourcemaps/custom-props.less', kind: 'map', expected: 'sourcemaps/custom-props.json', layout: 'legacy' },

  /*
   * Its golden's annotation names `tests-config/sourcemaps-comprehensive/`; the
   * fixture lives in `tests-config/sourcemaps/comprehensive/` and its config is
   * `sourceMap: true`, for which Less 4.x writes `comprehensive.css.map`.
   */
  { file: 'tests-config/sourcemaps/comprehensive/comprehensive.less', kind: 'map', expected: 'sourcemaps/comprehensive.json', layout: 'current', staleGoldenAnnotation: true },
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

  /* Every mapping lands on the same token in the output and in its source. */
  const body = css.replace(ANNOTATION, '');
  const genLines = body.split('\n');
  const sourceText = map.sources.map(source => readFileSync(path.join(lessDir, path.basename(source)), 'utf8'));
  const segments = decodeSourceMapMappings(map.mappings);
  expect(segments.length).toBeGreaterThan(0);
  for (const [genLine, genCol, src, line, col] of segments) {
    const text = sourceText[src!];
    expect(text, `mapping names source #${src}`).toBeDefined();
    expect(line!, 'mapped line is inside its source').toBeLessThan(text!.split('\n').length);
    const genToken = tokenAt(body, genLine!, genCol!);
    const srcToken = tokenAt(text!, line!, col!);

    /*
     * Computed output maps to the authored expression that produced it: a
     * variable, call or group, or a selector written against its parent (`&`).
     */
    const authored = (text!.split('\n')[line!] ?? '').slice(col!).trimStart();
    const computed = /^[@$~(&]/u.test(authored) || /^[-\w]+\(/u.test(authored);
    expect(
      genToken === srcToken || computed || (genLines[genLine!] ?? '').includes(srcToken),
      `gen ${genLine! + 1}:${genCol} "${genToken}" does not round-trip to ${map.sources[src!]} ${line! + 1}:${col} "${srcToken}"`
    ).toBe(true);
  }

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
        expect(result.css).not.toMatch(/\/\*# sourceMappingURL=.+\.css\.map \*\/$/);
      }

      const golden = path.join(testData, fixture.file.replace(/\.less$/, '.css'));
      if (existsSync(golden)) {
        const goldenCss = readFileSync(golden, 'utf8');
        if (fixture.staleGoldenAnnotation) {
          expect(result.css.replace(ANNOTATION, '')).toBe(goldenCss.replace(ANNOTATION, ''));
        } else {
          expect(result.css).toBe(goldenCss);
        }
      }
      checkMap(fixture, result.css, result.map!);
    });
  }
});
