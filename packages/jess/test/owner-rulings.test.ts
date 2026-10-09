/**
 * OWNER-RULING CONFORMANCE TESTS — OWNER-LOCKED FILE.
 *
 * One `it` per owner ruling, titled `<ledger id> (owner <date>): <the ruled
 * output>`, asserting the ruled output from a minimal probe. The ruling is the
 * spec; this file is its executable form. Less v5 is a breaking release, so
 * Less 4.x / lessc output is never a reason to change an expectation here.
 *
 * Every test body (and this preamble) is hashed into
 * `docs/architecture/core/owner-rulings.lock.json`; `pnpm check:guardrails`
 * fails when one changes without the lock, and names the ruling. Owner rulings
 * change only with the owner's explicit approval — when code disagrees with a
 * test here, the CODE is the defect: fix it, or escalate to the owner. Never
 * edit the expectation, the ledger row, a golden or the docs to match the code
 * or lessc. After an approved change, `pnpm rulings:lock` regenerates the lock.
 *
 * `it.fails` marks a ruling the current code contradicts. It passes while the
 * code is wrong and turns red when the fix lands: then change it to `it` (and
 * regenerate the lock) in the fixing commit.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

type CollapseNesting = false | 'native' | 'compact';

async function render(source: string, collapseNesting: CollapseNesting = false): Promise<string> {
  const compiler = new Compiler({ output: { collapseNesting } });
  return String(await compiler.renderString(source, { filePath: 'entry.less', extension: '.less', suppressWarnings: true }));
}

/** Compile `source` as the dialect `extension` names (`.less`, `.scss`, `.jess`), nested output. */
async function compile(source: string, extension: '.less' | '.scss' | '.jess'): Promise<string> {
  return String(await new Compiler().renderString(source, { filePath: `entry${extension}`, extension, suppressWarnings: true }));
}

/*
 * P45: well-formed input parses and evaluates in every dialect. Each `it.fails`
 * below stops with a parse error today; it turns red when the grammar lane
 * fixes it. The assertion is deliberately loose about bytes: what is ruled is
 * that the document compiles and keeps the construct.
 */
describe('P45 (owner 2026-10-09): well-formed input never stops the pipeline', () => {
  it.fails('P45 (owner 2026-10-09): SCSS gives a parenthesized comparison its Sass meaning, `x: (3px > 2px)` is `x: true`', async () => {
    await expect(compile('.a { x: (3px > 2px); }', '.scss')).resolves.toContain('x: true');
  });

  it.fails('P45 (owner 2026-10-09): SCSS gives a bare comparison its Sass meaning, `x: 3px > 2px` is `x: true`', async () => {
    await expect(compile('.a { x: 3px > 2px; }', '.scss')).resolves.toContain('x: true');
  });

  it.fails('P45 (owner 2026-10-09): Less parses `@supports selector(a > b)`', async () => {
    await expect(compile('@supports selector(a > b) { .x { y: z; } }', '.less')).resolves.toContain('@supports selector(a > b)');
  });

  it.fails('P45 (owner 2026-10-09): .jess parses a comment between two values, `b: x /**/ y`', async () => {
    await expect(compile('.a { b: x /**/ y; }', '.jess')).resolves.toContain('b: x');
  });

  it.fails('P45 (owner 2026-10-09): .jess parses `@media (min-width: calc(100px + 1px))`', async () => {
    await expect(compile('@media (min-width: calc(100px + 1px)) { .a { b: c; } }', '.jess')).resolves.toContain('@media');
  });

  it.fails('P45 (owner 2026-10-09): .jess parses an unknown at-rule statement, `@foo 1 + 2;`', async () => {
    await expect(compile('@foo 1 + 2;', '.jess')).resolves.toContain('@foo');
  });

  it.fails('P45 (owner 2026-10-09): SCSS parses a line comment inside a call, `max(1px, // c` then `2px)`', async () => {
    await expect(compile('.a { b: max(1px, // c\n 2px); }', '.scss')).resolves.toContain('b:');
  });

  it.fails('P45 (owner 2026-10-09): SCSS parses `var(--x, /img)`', async () => {
    await expect(compile('.a { b: var(--x, /img); }', '.scss')).resolves.toContain('var(--x, /img)');
  });

  it.fails('P45 (owner 2026-10-09): SCSS parses a comment inside a compound selector, `.e/*y*/.f`', async () => {
    await expect(compile('.e/*y*/.f { a: b; }', '.scss')).resolves.toMatch(/\.e[^{]*\.f/);
  });

  it.fails('P45 (owner 2026-10-09): SCSS parses `url( "a b.png" )`', async () => {
    await expect(compile('.a { b: url( "a b.png" ); }', '.scss')).resolves.toContain('url(');
  });

  it.fails('P45 (owner 2026-10-09): .jess parses `url( "a b.png" )`', async () => {
    await expect(compile('.a { b: url( "a b.png" ); }', '.jess')).resolves.toContain('url(');
  });

  it.fails('P45 (owner 2026-10-09): SCSS parses the ident `--` as a value, `d: --`', async () => {
    await expect(compile('.a { d: --; }', '.scss')).resolves.toContain('d: --');
  });

  it.fails('P45 (owner 2026-10-09): .jess parses the ident `--` as a value, `d: --`', async () => {
    await expect(compile('.a { d: --; }', '.jess')).resolves.toContain('d: --');
  });

  it.fails('P45 (owner 2026-10-09): Less parses a general-enclosed container query, `@container ( foo(x) )`', async () => {
    await expect(compile('@container ( foo(x) ) { .a { b: c; } }', '.less')).resolves.toContain('@container');
  });

  it.fails('P45 (owner 2026-10-09): .jess parses a general-enclosed container query, `@container ( foo(x) )`', async () => {
    await expect(compile('@container ( foo(x) ) { .a { b: c; } }', '.jess')).resolves.toContain('@container');
  });
});

describe('owner rulings (Less 5)', () => {
  it.fails('P2 (owner, reaffirmed 2026-10-09): a bare @var in a custom property is written as authored', async () => {
    await expect(render('@c: red;\n.a { --x: @c; }')).resolves.toBe('.a {\n  --x: @c;\n}\n');
  });

  it.fails('owner 2026-10-09 (golden review; J13 is stale): .active& under a multi-compound parent keeps .active as the subject', async () => {
    const out = await render('.extend-this { a: b; }\n.first-level {\n  .second-level {\n    .active&:extend(.extend-this) {}\n  }\n}');
    expect(out).toContain('.active:is(.first-level .second-level)');
  });

  it.fails('owner 2026-10-09 (golden review): escaped selector text before & is written as authored, not :is()-wrapped', async () => {
    const out = await render('@cq: ~\'.a, .b, .c\';\n.bar2 {\n  .q@{cq}&:hover { color: green; }\n}');
    expect(out).toContain('.q.a, .b, .c&:hover {');
  });

  it.fails('owner 2026-10-09 (golden review): two adjacent escaped selector texts are written as authored, not :is()-wrapped', async () => {
    const out = await render('@c: ~\'.a, .b\';\n@d: ~\'.c, .d\';\n@{c}@{d} { foo: bar; }');
    expect(out).toContain('.a, .b.c, .d {');
  });

  it('M1 (owner): a merged property is written at its LAST occurrence', async () => {
    await expect(render('.a { b+: 1; c: 2; b+: 3; }')).resolves.toBe('.a {\n  c: 2;\n  b: 1, 3;\n}\n');
  });

  it('V1 (owner): an un-operated literal is written as authored', async () => {
    await expect(render('.a { b: 1.0px 2PX 1e3px #989 0.50em; }')).resolves.toBe('.a {\n  b: 1.0px 2PX 1e3px #989 0.50em;\n}\n');
  });

  it('V4 (owner 2026-07-24): a computed number is the shortest decimal within 1e-10, never rounded to 8 places', async () => {
    await expect(render('.a { b: (1 / 3); c: (10px / 3); }')).resolves.toBe('.a {\n  b: 0.33333333333;\n  c: 3.3333333333px;\n}\n');
  });

  it('V8 (owner 2026-10-05): round() breaks a tie away from zero', async () => {
    await expect(render('.a { b: round(2.5) round(-2.5) round(-0.5) round(1.55, 1) round(-1.55, 1); }'))
      .resolves.toBe('.a {\n  b: 3 -3 -1 1.6 -1.6;\n}\n');
  });

  it('V12 (owner 2026-07-18 via F1, restated 2026-09-03, reaffirmed 2026-10-04): an un-operated / is written spaced', async () => {
    await expect(render('.a { font: bold 12px/1.5 sans-serif; b: 16/9; }'))
      .resolves.toBe('.a {\n  font: bold 12px / 1.5 sans-serif;\n  b: 16 / 9;\n}\n');
  });

  it('V27 (owner 2026-10-06, final): a unitless operand adopts the unit; two real units are kept as calc()', async () => {
    await expect(render('.a { b: 4 + 3px; c: 1.5 - 1rem; d: 1px + 1em; }'))
      .resolves.toBe('.a {\n  b: 7px;\n  c: 0.5rem;\n  d: calc(1px + 1em);\n}\n');
  });

  it('O1 (owner): the default output keeps nesting', async () => {
    await expect(render('.card { padding: 1rem; .title { font-weight: 600; } }'))
      .resolves.toBe('.card {\n  padding: 1rem;\n  .title {\n    font-weight: 600;\n  }\n}\n');
  });

  it('O2 (owner, restated 2026-09-03): nested @media rules are never merged', async () => {
    const out = await render('@media screen { @media (min-width: 40em) { .a { b: c; } } }', 'native');
    expect(out).not.toContain(' and ');
    expect(out).toContain('@media screen {');
    expect(out).toContain('@media (min-width: 40em) {');
  });

  it('O10 (owner 2026-10-05): a flattened rule under a selector list factors the list into one :is()', async () => {
    await expect(render('.a, #b { .c { color: red; } }', 'native')).resolves.toBe(':is(.a, #b) .c {\n  color: red;\n}\n');
  });

  it('C10 (owner correction 2026-07-22): collapsed nesting keeps authored declaration order', async () => {
    await expect(render('.a { b: 1; .c { d: 2; } e: 3; }', 'native'))
      .resolves.toBe('.a {\n  b: 1;\n}\n.a .c {\n  d: 2;\n}\n.a {\n  e: 3;\n}\n');
  });

  it('R9 (owner): a lexical variable wins over one a later mixin call unlocks', async () => {
    await expect(render('@mix: blue;\n.mixin() { @mix: #989; }\n.tiny-scope { color: @mix; .mixin(); }'))
      .resolves.toBe('.tiny-scope {\n  color: blue;\n}\n');
  });

  it('C17 (owner 2026-10-04): a built-in call with too many arguments is written as authored', async () => {
    await expect(render('.a { b: percentage(0.5, 1); c: cos(1, 2, 3); }'))
      .resolves.toBe('.a {\n  b: percentage(0.5, 1);\n  c: cos(1, 2, 3);\n}\n');
  });

  it('C20 (owner 2026-10-04): min()/max() over incompatible units is written as authored', async () => {
    await expect(render('.a { b: min(6em, 5, 4ex); }')).resolves.toBe('.a {\n  b: min(6em, 5, 4ex);\n}\n');
  });

  it('V22 (owner 2026-10-06): an escaped string is never read back as a number', async () => {
    await expect(render('@x: 0.5;\n.a { b: percentage(@x); c: percentage(~"@{x}"); }'))
      .resolves.toBe('.a {\n  b: 50%;\n  c: percentage(0.5);\n}\n');
  });

  it('P7 (owner): a bare @var in an at-rule prelude is an error', async () => {
    await expect(render('@m: screen;\n@media @m { .a { b: c; } }')).rejects.toThrow();
  });

  it('X3 (owner 2026-10-05): an all extend groups equal-specificity extenders into an :is() at the match', async () => {
    await expect(render('.a .c { color: red; }\n.d:extend(.c all) {}\n#e:extend(.c all) {}'))
      .resolves.toBe('.a :is(.c, .d),\n.a #e {\n  color: red;\n}\n');
  });

  it('O9 (owner 2026-10-04): a root & before content drops; a lone root & is kept', async () => {
    await expect(render('& .x { a: b; }')).resolves.toBe('.x {\n  a: b;\n}\n');
    await expect(render('& { a: b; }')).resolves.toBe('& {\n  a: b;\n}\n');
  });

  it('F12 (owner 2026-07-24): a custom property keeps its comments and trims edge whitespace', async () => {
    await expect(render('.a { --x: /* c */ red; --y:   blue  ; }')).resolves.toBe('.a {\n  --x: /* c */ red;\n  --y: blue;\n}\n');
  });

  it('P35 (owner 2026-09-23; parens owner 2026-10-06): math inside calc() keeps its authored parentheses', async () => {
    await expect(render('.a { b: calc(50% + (50vh / 2 - 20px)); }')).resolves.toBe('.a {\n  b: calc(50% + (50vh / 2 - 20px));\n}\n');
  });
});
