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
fs.writeFileSync(path.join(dir, 'r2.less'), '.sm { b: 2; .in { c: 3; } }\n.other { o: 1; }\n');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function render(source: string, ext: 'less' | 'scss' | 'jess', collapseNesting: boolean, compress = false): Promise<string> {
  return new Compiler({ output: { collapseNesting, compress } }).renderString(source, {
    filePath: path.join(dir, `entry.${ext}`),
    extension: `.${ext}`
  });
}

/**
 * [name, dialect, placed source, the same rules written where they are placed (null where
 * no source writes a hidden rule in place), nested output, flat output]
 */
const cases: Array<[string, 'less' | 'scss' | 'jess', string, string | null, string | null, string | null]> = [
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
    'a (reference) @import inside a rule whose rules nest: only the extender is written',
    'less',
    '.wrap { @import (reference) "r2.less"; } .x:extend(.wrap .sm) {}',
    null,
    '.x {\n  b: 2;\n}\n',
    '.x {\n  b: 2;\n}\n'
  ],
  [
    'a (reference) @import inside a rule: a rule under the hidden rule an `all` extender reveals is written under the extender',
    'less',
    '.wrap { @import (reference) "r2.less"; } .x:extend(.wrap .sm all) {}',
    null,
    '.x {\n  b: 2;\n  .in {\n    c: 3;\n  }\n}\n',
    '.x {\n  b: 2;\n}\n.x .in {\n  c: 3;\n}\n'
  ],
  [
    'a (reference) @import inside a rule nothing reveals writes nothing, and the rules after it stay outside it',
    'less',
    '.wrap { @import (reference) "r2.less"; } .after { a: 1; } .x:extend(.nope) {}',
    null,
    '.after {\n  a: 1;\n}\n',
    '.after {\n  a: 1;\n}\n'
  ],
  [
    'a moved block keeps the bytes of a string written over lines',
    'less',
    '@d: { .b { content: "a\\\n        b"; } }; .z { .a { @d(); } } .q:extend(.z .a .b){}',
    '.z { .a { .b { content: "a\\\n        b"; } } } .q:extend(.z .a .b){}',
    '.z .a .b,\n.q {\n  content: "a\\\n        b";\n}\n',
    '.z .a .b,\n.q {\n  content: "a\\\n        b";\n}\n'
  ],
  [
    'a split keeps a comment inside a custom property value, and leaves a statement comment',
    'less',
    '.m(){ .b { /* s */ --x: a\n/* c */\nb; y: 1; .c { x: 1 } } } .a { .m(); } .q:extend(.a .b){}',
    '.a { .b { /* s */ --x: a\n/* c */\nb; y: 1; .c { x: 1 } } } .q:extend(.a .b){}',
    '.a {\n  .b {\n    --x: a\n/* c */\nb;\n    /* s */\n    y: 1;\n    .c {\n      x: 1;\n    }\n  }\n}\n.q {\n  --x: a\n/* c */\nb;\n  y: 1;\n}\n',
    '.a .b,\n.q {\n  --x: a\n/* c */\nb;\n  /* s */\n  y: 1;\n}\n.a .b .c {\n  x: 1;\n}\n'
  ],
  [
    'a split ending in a custom property keeps its `;` under compress',
    'less',
    '.m(){ .b { y: 1; --z: 2; .c { x: 1 } } } .a { .m(); } .q:extend(.a .b){}',
    '.a { .b { y: 1; --z: 2; .c { x: 1 } } } .q:extend(.a .b){}',
    '.a {\n  .b {\n    y: 1;\n    --z: 2;\n    .c {\n      x: 1;\n    }\n  }\n}\n.q {\n  y: 1;\n  --z: 2;\n}\n',
    '.a .b,\n.q {\n  y: 1;\n  --z: 2;\n}\n.a .b .c {\n  x: 1;\n}\n'
  ],
  [
    'a mixin\'s `&` block: an exact extender of the rule it lands in splits off a target with children',
    'less',
    '.n(){ & { y: 1; .c { x: 1 } } } .a .b { .n(); } .q:extend(.a .b){}',
    '.a .b { & { y: 1; .c { x: 1 } } } .q:extend(.a .b){}',
    '.a .b {\n  & {\n    y: 1;\n    .c {\n      x: 1;\n    }\n  }\n}\n.q {\n  y: 1;\n}\n',
    '.a .b,\n.q {\n  y: 1;\n}\n.a .b .c {\n  x: 1;\n}\n'
  ],
  [
    'a mixin\'s guarded `&` block (#button-size): an exact extender keeps both declaration blocks',
    'less',
    '#bs(@r) { p: 1; & when (true) { br: @r; .c { x: 1 } } } .btn-lg { #bs(2); } .g:extend(.btn-lg) {}',
    '.btn-lg { p: 1; & when (true) { br: 2; .c { x: 1 } } } .g:extend(.btn-lg) {}',
    null,
    null
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
  /*
   * PINNED DEFECT DF11: a multi-line value in a block the fold moves keeps the
   * continuation indent of the depth it was written at; written in place it takes the
   * landing depth's (`    "b"`).
   */
  it('keeps a moved multi-line value\'s continuation indent (DF11)', async () => {
    await expect(render('@d: { .b { grid-template-areas: "a"\n   "b"; } }; .w { .a { @d(); } } .q:extend(.w .a .b){}', 'less', false))
      .resolves.toBe('.w .a .b,\n.q {\n  grid-template-areas: "a"\n        "b";\n}\n');
  });

  for (const [name, ext, placed, written, nested, flat] of cases) {
    it(name, async () => {
      if (nested !== null) {
        await expect(render(placed, ext, false)).resolves.toBe(nested);
      }
      if (written !== null) {
        await expect(render(written, ext, false)).resolves.toBe(nested ?? await render(placed, ext, false));
        await expect(render(placed, ext, false, true)).resolves.toBe(await render(written, ext, false, true));
      }
      if (flat !== null) {
        await expect(render(placed, ext, true)).resolves.toBe(flat);
      }
    });
  }
});
