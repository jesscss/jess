import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeModulesPlugin } from '@jesscss/plugin-node-modules';
import { renderAstDoc } from './whole-doc-driver.js';
import type { ModuleResolver } from '../import.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * [import:module] A bare package specifier (`@import "@scope/pkg/x"`) is NOT a
 * relative path — it names a `node_modules` package resolved via Node's module
 * algorithm. Core stays IO/parser-clean: the resolver is an INJECTED capability
 * (`resolveModule`) supplied here by `@jesscss/plugin-node-modules`, mirroring the
 * production Less binding + the differential oracle. This pins that a package
 * specifier resolves + INLINES its target (with and without the `.less` suffix on
 * the specifier), while a relative import is unaffected by the resolver.
 */
const ev = buildEvaluator(makeBuiltinRegistry());

let root: string; // a temp project root: <root>/node_modules/@scope/pkg/*.less + entry
let resolveModule: ModuleResolver;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-module-'));
  const pkg = path.join(root, 'node_modules', '@scope', 'pkg', 'nested');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '@scope', 'pkg', 'theme.less'), '.theme { color: red; }\n');
  fs.writeFileSync(path.join(pkg, 'deep.less'), '.deep { color: blue; }\n');

  const plugin = new NodeModulesPlugin({ basePath: root });
  resolveModule = (spec, fromDir) => plugin.resolvePackage(spec, fromDir) ?? plugin.resolvePackage(spec);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function render(src: string, withResolver = true): string {
  const r = renderAstDoc(src, {
    filePath: path.join(root, 'main.less'),
    evaluator: ev,
    resolveModule: withResolver ? resolveModule : undefined,
  });
  if (r.threw) throw r.threw;
  if (r.css === undefined) throw new Error(`no css (parse errors: ${JSON.stringify(r.parseErrors)})`);
  return r.css;
}

describe('[import:module] package-specifier @import resolution', () => {
  it('resolves + inlines a package specifier carrying its .less extension', () => {
    const css = render('@import "@scope/pkg/theme.less";');
    expect(css).toContain('.theme');
    expect(css).toContain('color: red');
  });

  it('resolves an extensionless package specifier by probing the .less candidate', () => {
    const css = render('@import "@scope/pkg/theme";');
    expect(css).toContain('.theme');
  });

  it('resolves a deep subpath inside the package', () => {
    const css = render('@import "@scope/pkg/nested/deep";');
    expect(css).toContain('.deep');
    expect(css).toContain('color: blue');
  });

  it('leaves the @import verbatim when no resolver is injected', () => {
    const css = render('@import "@scope/pkg/theme";', false);
    expect(css).toContain('@import "@scope/pkg/theme"');
    expect(css).not.toContain('.theme');
  });
});
