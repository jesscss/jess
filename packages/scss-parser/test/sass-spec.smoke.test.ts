import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Parser } from '../src/index.js';

type HrxFile = { filePath: string; sectionPath: string; contents: string };

function parseHrx(text: string, filePath: string): HrxFile[] {
  // Very small subset HRX parser:
  // Sections look like:
  // ==== path/inside/fixture.scss ====
  // <contents...>
  const out: HrxFile[] = [];
  const lines = text.split(/\r?\n/);
  let currentPath: string | undefined;
  let buf: string[] = [];

  const flush = () => {
    if (!currentPath) return;
    out.push({ filePath, sectionPath: currentPath, contents: buf.join('\n') });
  };

  for (const line of lines) {
    const m = /^====\s+(.+?)\s+====\s*$/.exec(line);
    if (m) {
      flush();
      currentPath = m[1];
      buf = [];
    } else {
      buf.push(line);
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
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('sass-spec smoke (parse-only)', () => {
  const require = createRequire(import.meta.url);
  const MAX_HRX_FILES = Number(process.env.SASS_SPEC_MAX_HRX ?? 25);

  it('parses a small curated subset of sass-spec .hrx inputs', () => {
    const sassSpecDir = path.dirname(require.resolve('sass-spec/package.json'));
    const specRoot = path.join(sassSpecDir, 'spec');
    if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
      throw new Error(`sass-spec "spec" directory not found at ${specRoot}`);
    }

    const parser = new Parser();

    const all = walk(specRoot).filter(p => p.endsWith('.hrx')).sort();

    // Curated-ish subset: stable selection by path keywords, then capped.
    const interesting = all.filter(p => {
      const rel = path.relative(specRoot, p).toLowerCase();
      return rel.includes('mixin')
        || rel.includes('map')
        || rel.includes('module')
        || rel.includes('use')
        || rel.includes('forward')
        || rel.includes('if');
    });

    const selected = (interesting.length ? interesting : all).slice(0, MAX_HRX_FILES);
    expect(selected.length).toBeGreaterThan(0);

    for (const hrxPath of selected) {
      const hrxText = fs.readFileSync(hrxPath, 'utf8');
      const sections = parseHrx(hrxText, hrxPath);
      const scssInputs = sections.filter(s => s.sectionPath.endsWith('.scss'));

      for (const input of scssInputs) {
        const result = parser.parse(input.contents, 'stylesheet');
        expect(result.lexerResult.errors, `${hrxPath} :: ${input.sectionPath}`).toEqual([]);
        expect(result.errors.map(e => e.message), `${hrxPath} :: ${input.sectionPath}`).toEqual([]);
      }
    }
  });

  describe('sass-spec smoke (per .hrx section)', () => {
    const sassSpecDir = path.dirname(require.resolve('sass-spec/package.json'));
    const specRoot = path.join(sassSpecDir, 'spec');
    if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
      throw new Error(`sass-spec "spec" directory not found at ${specRoot}`);
    }

    const all = walk(specRoot).filter(p => p.endsWith('.hrx')).sort();
    const interesting = all.filter(p => {
      const rel = path.relative(specRoot, p).toLowerCase();
      return rel.includes('mixin')
        || rel.includes('map')
        || rel.includes('module')
        || rel.includes('use')
        || rel.includes('forward')
        || rel.includes('if');
    });
    const selected = (interesting.length ? interesting : all).slice(0, MAX_HRX_FILES);

    // Materialize SCSS input sections so Vitest shows each as its own test.
    // This makes it obvious *which* fixture broke parsing.
    const cases = selected.flatMap(hrxPath => {
      const hrxText = fs.readFileSync(hrxPath, 'utf8');
      const sections = parseHrx(hrxText, hrxPath);
      return sections
        .filter(s => s.sectionPath.endsWith('.scss'))
        .map(s => ({
          hrxPath,
          sectionPath: s.sectionPath,
          contents: s.contents
        }));
    });

    it('has at least one .scss section in selected .hrx fixtures', () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    for (const c of cases) {
      const rel = path.relative(specRoot, c.hrxPath);
      it(`${rel} :: ${c.sectionPath}`, () => {
        const parser = new Parser();
        const result = parser.parse(c.contents, 'stylesheet');
        expect(result.lexerResult.errors, `${rel} :: ${c.sectionPath}`).toEqual([]);
        expect(result.errors.map(e => e.message), `${rel} :: ${c.sectionPath}`).toEqual([]);
      });
    }
  });
});

