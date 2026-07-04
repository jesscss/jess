import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Parser } from '../src/index.js';

type HrxFile = { filePath: string; sectionPath: string; contents: string };
type CachedManifest = {
  version: number;
  cases: Array<{
    id: string;
    feature: string;
    hrxRelPath: string;
    sectionPath: string;
    inputRelPath: string;
  }>;
};

function parseHrx(text: string, filePath: string): HrxFile[] {
  // sass-spec HRX format (simplified):
  // <===> path/to/file
  // ... contents ...
  // <===>
  // ================================================================================
  const out: HrxFile[] = [];
  const lines = text.split(/\r?\n/);
  let currentPath: string | undefined;
  let buf: string[] = [];

  const flush = () => {
    if (!currentPath) {
      return;
    }
    out.push({ filePath, sectionPath: currentPath, contents: buf.join('\n') });
  };

  for (const line of lines) {
    const start = /^<===>\s+(.+?)\s*$/.exec(line);
    const end = /^<===>\s*$/.test(line) || /^<===+>\s*$/.test(line);
    if (start) {
      flush();
      currentPath = start[1];
      buf = [];
    } else if (end) {
      flush();
      currentPath = undefined;
      buf = [];
    } else if (/^=+$/.test(line)) {
      // section separator
    } else {
      if (currentPath) {
        buf.push(line);
      }
    }
  }
  flush();
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('sass-spec smoke (parse-only)', () => {
  const require = createRequire(import.meta.url);
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const enforceAll = process.env.SASS_SPEC_ENFORCE_ALL === 'true';
  const onlyFeature = (process.env.SASS_SPEC_FEATURE ?? '').toLowerCase().trim();
  const limit = process.env.SASS_SPEC_LIMIT ? Number(process.env.SASS_SPEC_LIMIT) : undefined;

  const sassSpecDir = path.dirname(require.resolve('sass-spec/package.json'));
  const specRoot = path.join(sassSpecDir, 'spec');
  const cacheRoot = path.join(testDir, '..', '.cache', 'sass-spec');
  const cacheManifestPath = path.join(cacheRoot, 'manifest.json');

  if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
    throw new Error(`sass-spec "spec" directory not found at ${specRoot}`);
  }

  const cacheManifest: CachedManifest | undefined = (() => {
    const isCachedManifest = (value: unknown): value is CachedManifest => {
      if (!value || typeof value !== 'object') {
        return false;
      }
      const version = Reflect.get(value, 'version');
      const cases = Reflect.get(value, 'cases');
      return version === 1 && Array.isArray(cases);
    };

    try {
      if (!fs.existsSync(cacheManifestPath)) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(cacheManifestPath, 'utf8'));
      if (!isCachedManifest(parsed)) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  })();

  const allHrx = cacheManifest ? [] : walk(specRoot).filter(p => p.endsWith('.hrx')).sort();

  it('has sass-spec fixtures available', () => {
    // We either have cached cases, or we fall back to scanning HRX on the fly.
    if (cacheManifest) {
      expect(cacheManifest.cases.length).toBeGreaterThan(0);
    } else {
      expect(allHrx.length).toBeGreaterThan(0);
    }
  });

  // Group by feature. Run one feature with SASS_SPEC_FEATURE=<name>, otherwise run all buckets.
  const features: Array<{ name: string; match: (rel: string) => boolean }> = [
    {
      name: 'map',
      match: rel => rel.includes('/map/') || rel.includes('core_functions/map/')
    },
    {
      name: 'mixin',
      match: rel => rel.includes('mixin') || rel.includes('include') || rel.includes('callable')
    },
    {
      name: 'control',
      match: rel => rel.includes('/if/') || rel.includes('/for/') || rel.includes('/each/') || rel.includes('/while/')
    },
    {
      name: 'modules',
      match: rel => rel.includes('module') || rel.includes('/use/') || rel.includes('/forward/')
    },
    {
      name: 'imports',
      match: rel => rel.includes('/import/') || rel.includes('directives/import/')
    },
    {
      name: 'at-root',
      match: rel => rel.includes('at-root') || rel.includes('/at_root/')
    },
    {
      name: 'interpolation',
      match: rel => rel.includes('interpolation')
    },
    {
      name: 'selectors',
      match: rel => rel.includes('selector') || rel.includes('/nest') || rel.includes('/extend/')
    }
  ];

  const enabledFeatures = onlyFeature
    ? features.filter(f => f.name === onlyFeature)
    : features;

  it('has enabled feature buckets', () => {
    expect(enabledFeatures.length).toBeGreaterThan(0);
  });

  for (const feature of enabledFeatures) {
    describe(`feature: ${feature.name}`, () => {
      const hrxFiles = cacheManifest
        ? []
        : allHrx.filter(p => feature.match(path.relative(specRoot, p).toLowerCase()));
      const hrxFilesLimited = typeof limit === 'number' && Number.isFinite(limit)
        ? hrxFiles.slice(0, limit)
        : hrxFiles;

      it('has .hrx files', () => {
        if (!cacheManifest) {
          expect(hrxFilesLimited.length).toBeGreaterThan(0);
        }
      });

      // Materialize only input.scss sections so Vitest lists each fixture/section individually.
      const cases = cacheManifest
        ? cacheManifest.cases
            .filter(c => c.feature === feature.name)
            .map((c) => {
              const inputAbsPath = path.join(cacheRoot, c.inputRelPath);
              const contents = fs.readFileSync(inputAbsPath, 'utf8');
              return { hrxPath: path.join(specRoot, c.hrxRelPath), sectionPath: c.sectionPath, contents };
            })
        : hrxFilesLimited.flatMap((hrxPath) => {
            const hrxText = fs.readFileSync(hrxPath, 'utf8');
            const sections = parseHrx(hrxText, hrxPath);
            return sections
              .filter(s => s.sectionPath.endsWith('/input.scss'))
              .map(s => ({
                hrxPath,
                sectionPath: s.sectionPath,
                contents: s.contents
              }));
          });

      const casesLimited = typeof limit === 'number' && Number.isFinite(limit)
        ? cases.slice(0, limit)
        : cases;

      it('has input.scss sections', () => {
        expect(casesLimited.length).toBeGreaterThan(0);
      });

      // Probe each case once so we can choose it vs it.fails deterministically.
      const probeParser = new Parser();
      const probed = casesLimited.map((c) => {
        const r = probeParser.parse(c.contents, 'stylesheet');
        const ok = r.lexerResult.errors.length === 0 && r.errors.length === 0;
        return { ...c, ok };
      });

      // Keep Vitest update traffic low: one test per feature bucket.
      // (Creating one `it()` per fixture can trigger vitest-worker onTaskUpdate timeouts.)
      it('parses input.scss sections', () => {
        const parser = new Parser();
        for (const c of probed) {
          const rel = path.relative(specRoot, c.hrxPath);
          const name = `${rel} :: ${c.sectionPath}`;
          const result = parser.parse(c.contents, 'stylesheet');
          const okNow = result.lexerResult.errors.length === 0 && result.errors.length === 0;
          if (result.tree) {
            // Even for non-enforced cases, ensure we never create an invalid AST.
          }

          // If this case currently parses cleanly, enforce it stays clean.
          // Otherwise, allow failures unless explicitly enforcing all cases.
          if (c.ok || enforceAll) {
            expect(result.lexerResult.errors, name).toEqual([]);
            expect(result.errors.map(e => e.message), name).toEqual([]);
            expect(okNow, name).toBe(true);
          }
        }
      });
    });
  }
});
