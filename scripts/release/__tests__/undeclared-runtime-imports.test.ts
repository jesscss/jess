import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findUndeclaredRuntimeImports } from '../release-utils.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function packageWith(files: Array<[file: string, text: string]>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jess-undeclared-imports-'));
  roots.push(dir);
  for (const [file, text] of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

const manifest = {
  name: '@jesscss/less-parser',
  dependencies: Object.fromEntries([['@jesscss/css-parser', '2.0.0']]),
  peerDependencies: { parseman: '^0.51.0' },
  devDependencies: Object.fromEntries([['@jesscss/parser-shared', '2.0.0']])
};

describe('findUndeclaredRuntimeImports', () => {
  it('reports a runtime import that is only a devDependency, per form', () => {
    const dir = packageWith([
      ['lib/grammar.js', 'import { a } from "@jesscss/parser-shared/recognition";\n'
      + 'import { b } from "@jesscss/parser-shared/pseudo-consts";\n'],
      ['lib/grammar.cjs', 'const a = require("@jesscss/parser-shared/recognition");\n'],
      ['lib/lazy.js', 'export const load = () => import(\'lodash/fp\');\n'],
      ['lib/side-effect.js', 'import "left-pad";\n'],
      ['lib/reexport.js', 'export {\n  b\n} from \'@scope/pkg\';\n']
    ]);
    expect([...findUndeclaredRuntimeImports(dir, manifest)].sort()).toEqual([
      ['@jesscss/parser-shared', ['lib/grammar.cjs', 'lib/grammar.js']],
      ['@scope/pkg', ['lib/reexport.js']],
      ['left-pad', ['lib/side-effect.js']],
      ['lodash', ['lib/lazy.js']]
    ]);
  });

  it('reads minified ES modules and template-literal requires', () => {
    const dir = packageWith([
      ['lib/index.js', 'import{a}from"./x.js";import{b as c}from"undeclared-esm";'
      + 'import d from"@jesscss/css-parser";export{c,d};'],
      ['lib/index.cjs', 'let a=require(`./x.cjs`),b=require(`undeclared-cjs`),'
      + 'e=__require("undeclared-shim");']
    ]);
    expect([...findUndeclaredRuntimeImports(dir, manifest)].sort()).toEqual([
      ['undeclared-cjs', ['lib/index.cjs']],
      ['undeclared-esm', ['lib/index.js']],
      ['undeclared-shim', ['lib/index.cjs']]
    ]);
  });

  it('accepts declared, builtin, relative and self imports', () => {
    const dir = packageWith([
      ['lib/index.js', [
        'import { parse } from "@jesscss/css-parser/grammar";',
        'import { compose } from "parseman";',
        'import fs from "node:fs";',
        'import path from "path";',
        'import { readFile } from "fs/promises";',
        'import { local } from "./local.js";',
        'import { internal } from "#internal";',
        'export * from "@jesscss/less-parser/cst";'
      ].join('\n')]
    ]);
    expect(findUndeclaredRuntimeImports(dir, manifest).size).toBe(0);
  });

  it('ignores text that only looks like an import, and nested node_modules', () => {
    const dir = packageWith([
      ['lib/worker.js', 'const require = s => { throw new Error(`require("${s}") is not supported`); };\n'
      + 'const word = keyword(\'import(\');\nconst note = "values from \'x\'";\n'
      + '/**\n * @example\n * @import "pkg/x";\n * import "in-a-comment";\n */\nexport {};\n'],
      ['lib/types.d.ts', 'import type { X } from "undeclared-types";\n'],
      ['node_modules/dep/index.js', 'import "undeclared-nested";\n']
    ]);
    expect(findUndeclaredRuntimeImports(dir, manifest).size).toBe(0);
  });
});
