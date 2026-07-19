import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * [import:paths] A relative `@import` that does NOT resolve against the importing
 * file's own directory is resolved against each configured include-path search dir
 * (Less's `paths` option). Resolution order matches Less: relative-to-importing-
 * file FIRST, then each `paths` entry in order. A relative search dir is resolved
 * against the importing file's directory (mirroring the legacy `BasePlugin.resolve`
 * + `data-uri`/`image-*` IO resolution, which honour `paths` the same way). This
 * pins the gap the `include-path` / `include-path-string` all-less fixtures cover.
 */
const ev = buildEvaluator(makeBuiltinRegistry());

let root: string; // <root>/src/main.less imports a file only reachable via <root>/vendor
let entryDir: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-paths-'));
  entryDir = path.join(root, 'src');
  const vendor = path.join(root, 'vendor');
  fs.mkdirSync(entryDir, { recursive: true });
  fs.mkdirSync(vendor, { recursive: true });
  // Only present under the search dir — NOT next to the entry file.
  fs.writeFileSync(path.join(vendor, 'theme.less'), '.theme { color: red; }\n');
  // A same-named file next to the entry, to prove local-dir wins over `paths`.
  fs.writeFileSync(path.join(vendor, 'shadowed.less'), '.from-vendor { x: 1; }\n');
  fs.writeFileSync(path.join(entryDir, 'shadowed.less'), '.from-local { x: 2; }\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function render(src: string, searchDirs?: readonly string[]): string {
  const r = renderAstDoc(src, {
    filePath: path.join(entryDir, 'main.less'),
    evaluator: ev,
    searchDirs,
  });
  if (r.threw) throw r.threw;
  if (r.css === undefined) throw new Error(`no css (parse errors: ${JSON.stringify(r.parseErrors)})`);
  return r.css;
}

describe('[import:paths] include-path @import resolution', () => {
  it('resolves + inlines an import found only via an absolute `paths` entry', () => {
    const css = render('@import "theme";', [path.join(root, 'vendor')]);
    expect(css).toContain('.theme');
    expect(css).toContain('color: red');
  });

  it('resolves a `paths` entry given relative to the importing file directory', () => {
    // `../vendor` is relative to <root>/src (the entry file's dir) → <root>/vendor.
    const css = render('@import "theme";', ['../vendor']);
    expect(css).toContain('.theme');
  });

  it('prefers the importing file directory over a `paths` entry', () => {
    const css = render('@import "shadowed";', [path.join(root, 'vendor')]);
    expect(css).toContain('.from-local');
    expect(css).not.toContain('.from-vendor');
  });

  it('leaves the @import verbatim when the file is absent from every search dir', () => {
    const css = render('@import "theme";');
    expect(css).toContain('@import "theme"');
    expect(css).not.toContain('.theme');
  });
});
