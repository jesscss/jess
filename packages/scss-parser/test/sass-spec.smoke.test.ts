import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Parser } from '../src/index.js';

type HrxFile = { filePath: string; sectionPath: string; contents: string };

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
  const enforceAll = process.env.SASS_SPEC_ENFORCE_ALL === 'true';
  const onlyFeature = (process.env.SASS_SPEC_FEATURE ?? '').toLowerCase().trim();
  const limit = process.env.SASS_SPEC_LIMIT ? Number(process.env.SASS_SPEC_LIMIT) : undefined;

  const sassSpecDir = path.dirname(require.resolve('sass-spec/package.json'));
  const specRoot = path.join(sassSpecDir, 'spec');

  if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
    throw new Error(`sass-spec "spec" directory not found at ${specRoot}`);
  }

  const allHrx = walk(specRoot).filter(p => p.endsWith('.hrx')).sort();

  it('has sass-spec fixtures available', () => {
    expect(allHrx.length).toBeGreaterThan(0);
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
      const hrxFiles = allHrx.filter(p => feature.match(path.relative(specRoot, p).toLowerCase()));
      const hrxFilesLimited = typeof limit === 'number' && Number.isFinite(limit)
        ? hrxFiles.slice(0, limit)
        : hrxFiles;

      it('has .hrx files', () => {
        expect(hrxFilesLimited.length).toBeGreaterThan(0);
      });

      // Materialize only input.scss sections so Vitest lists each fixture/section individually.
      const cases = hrxFilesLimited.flatMap((hrxPath) => {
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

      it('has input.scss sections', () => {
        expect(cases.length).toBeGreaterThan(0);
      });

      // Probe each case once so we can choose it vs it.fails deterministically.
      const probeParser = new Parser();
      const probed = cases.map((c) => {
        const r = probeParser.parse(c.contents, 'stylesheet');
        const ok = r.lexerResult.errors.length === 0 && r.errors.length === 0;
        return { ...c, ok };
      });

      for (const c of probed) {
        const rel = path.relative(specRoot, c.hrxPath);
        const name = `${rel} :: ${c.sectionPath}`;
        const test = c.ok ? it : (enforceAll ? it : it.fails);
        test(name, () => {
          const parser = new Parser();
          const result = parser.parse(c.contents, 'stylesheet');
          expect(result.lexerResult.errors, name).toEqual([]);
          expect(result.errors.map(e => e.message), name).toEqual([]);
        });
      }
    });
  }
});
