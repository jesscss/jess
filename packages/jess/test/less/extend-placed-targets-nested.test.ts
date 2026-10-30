/**
 * An extend target an evaluation step places — a mixin call, a detached-ruleset call, an
 * `@if` / loop body, an `@import` inside a rule, `(reference)` included — is written in
 * nested output (`collapseNesting: false`) exactly as the same rule written in its rule
 * is: the same flatten triggers, re-nesting, shared-prefix strip and exact-extender split
 * (ledger X22; EXTEND-SEMANTICS §7a, §7b). Flat output is unchanged by the rule.
 *
 * Cases: jesscss/jess#390, PINNED-DEFECTS-AUDIT DF6, the nested half of jesscss/jess#376.
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../../src/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-x22-'));
fs.writeFileSync(path.join(dir, 't.less'), '.y { &:extend(.w .k); }\n.k { k: 1; }\n');
fs.writeFileSync(path.join(dir, 'r.less'), '.sm { b: 2; }\n');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function render(source: string, ext: 'less' | 'scss' | 'jess', collapseNesting: boolean): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, {
    filePath: path.join(dir, `entry.${ext}`),
    extension: `.${ext}`
  });
}

/**
 * [name, dialect, placed source, the same rules written where they are placed (null where
 * no source writes a hidden rule in place), nested output, flat output]
 */
const cases: Array<[string, 'less' | 'scss' | 'jess', string, string | null, string, string]> = [
  [
    'a mixin call (jess#390, Less): the exact extender splits off the target with children',
    'less',
    '.m(){ .b{ y:1; .c{ x:1; } } } .a{ .m(); } .q:extend(.a .b){}',
    '.a{ .b{ y:1; .c{ x:1; } } } .q:extend(.a .b){}',
    '.a {\n  .b {\n    y: 1;\n    .c {\n      x: 1;\n    }\n  }\n}\n.q {\n  y: 1;\n}\n',
    '.a .b,\n.q {\n  y: 1;\n}\n.a .b .c {\n  x: 1;\n}\n'
  ],
  [
    'an @if body (jess#390, SCSS)',
    'scss',
    '.a { @if true { .b { y: 1; } } } .q { @extend .b; }',
    '.a { .b { y: 1; } } .q { @extend .b; }',
    '.a {\n  .b,\n  .q {\n    y: 1;\n  }\n}\n',
    '.a :is(.b, .q) {\n  y: 1;\n}\n'
  ],
  [
    'a detached-ruleset call: a whole-complex match from outside flattens the target',
    'less',
    '@d: { .b { y: 1; } }; .a { @d(); } .q:extend(.a .b) {}',
    '.a { .b { y: 1; } } .q:extend(.a .b) {}',
    '.a .b,\n.q {\n  y: 1;\n}\n',
    '.a .b,\n.q {\n  y: 1;\n}\n'
  ],
  [
    'an @import inside a rule: the shared prefix is stripped',
    'less',
    '.w { @import "t.less"; }',
    '.w { .y { &:extend(.w .k); } .k { k: 1; } }',
    '.w {\n  .k,\n  .y {\n    k: 1;\n  }\n}\n',
    '.w .k,\n.w .y {\n  k: 1;\n}\n'
  ],
  [
    'a (reference) @import inside a rule (jess#376): the extender reveals the hidden rule',
    'less',
    '.wrap { @import (reference) "r.less"; } .x:extend(.wrap .sm) {}',
    null,
    '.x {\n  b: 2;\n}\n',
    '.x {\n  b: 2;\n}\n'
  ],
  [
    'a mixin whose @media block extends the rule it lands in (DF6): the rule is written &',
    'less',
    '.m() { @media print { &:extend(.y .z); .z { c: 3; } } } .y { .m(); }',
    '.y { @media print { &:extend(.y .z); .z { c: 3; } } }',
    '.y {\n  @media print {\n    .z,\n    & {\n      c: 3;\n    }\n  }\n}\n',
    '@media print {\n  .y .z,\n  .y {\n    c: 3;\n  }\n}\n'
  ],
  [
    'an each() body (jess#376): an `all` whole-complex match flattens the generated rule',
    'less',
    '.wrap { each(a b, { .loop-target-@{value} { c: @value; } }); } .visible:extend(.wrap .loop-target-a all) {}',
    '.wrap { .loop-target-a { c: a; } .loop-target-b { c: b; } } .visible:extend(.wrap .loop-target-a all) {}',
    '.wrap {\n  .loop-target-b {\n    c: b;\n  }\n}\n.wrap .loop-target-a,\n.visible {\n  c: a;\n}\n',
    '.wrap .loop-target-a,\n.visible {\n  c: a;\n}\n.wrap .loop-target-b {\n  c: b;\n}\n'
  ],
  [
    'a .jess $if body',
    'jess',
    '.a { $if (true) { .b { y: 1; } } } .q { $extend .b; }',
    '.a { .b { y: 1; } } .q { $extend .b; }',
    '.a {\n  .b,\n  .q {\n    y: 1;\n  }\n}\n',
    '.a :is(.b, .q) {\n  y: 1;\n}\n'
  ],
  [
    'a .jess $if body at the root: !exact splits off a target with children',
    'jess',
    '$if (true) { .b { y: 1; .c { x: 1; } } } .q { $extend .b !exact; }',
    '.b { y: 1; .c { x: 1; } } .q { $extend .b !exact; }',
    '.b {\n  y: 1;\n  .c {\n    x: 1;\n  }\n}\n.q {\n  y: 1;\n}\n',
    '.b,\n.q {\n  y: 1;\n}\n.b .c {\n  x: 1;\n}\n'
  ],
  [
    'a placed target nothing extends stays nested',
    'less',
    '.m(){ .b{ y:1; .c{ x:1; } } } .a{ .m(); } .q:extend(.zz){}',
    '.a{ .b{ y:1; .c{ x:1; } } } .q:extend(.zz){}',
    '.a {\n  .b {\n    y: 1;\n    .c {\n      x: 1;\n    }\n  }\n}\n',
    '.a .b {\n  y: 1;\n}\n.a .b .c {\n  x: 1;\n}\n'
  ]
];

describe('placed extend targets in nested output (X22)', () => {
  for (const [name, ext, placed, written, nested, flat] of cases) {
    it(name, async () => {
      await expect(render(placed, ext, false)).resolves.toBe(nested);
      if (written !== null) {
        await expect(render(written, ext, false)).resolves.toBe(nested);
      }
      await expect(render(placed, ext, true)).resolves.toBe(flat);
    });
  }
});
