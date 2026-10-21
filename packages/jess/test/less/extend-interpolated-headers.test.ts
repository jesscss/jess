/**
 * An interpolated selector header is written the same whether or not the document
 * holds an extend: the extend planner reads the selector the header writer
 * resolves, so a selector list a lone interpolation expands (ledger O8(a)), a list
 * continuing a name (`.col-@{size}`, `#{&}__title`) and a `&` value keep their
 * branches. Where an extend applies, the interpolated rule extends as the rule
 * written out does.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type Language = 'less' | 'scss' | 'jess';

async function render(source: string, collapseNesting: boolean, language: Language): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, {
    language,
    filePath: `/virtual/extend-interpolated-headers.${language}`
  });
}

/** An extend that reaches nothing in the cases below, in each dialect's spelling. */
const unrelated: Record<Language, string> = {
  less: '.alert { padding: 1em; }\n.alert-danger:extend(.alert) { color: red; }',
  scss: '.alert { padding: 1em; }\n.alert-danger { @extend .alert; color: red; }',
  jess: '.alert { padding: 1em; }\n.alert-danger { $extend .alert; color: red; }'
};

/** Interpolated headers, and the same rules written out. */
const cases: ReadonlyArray<readonly [Language, string, string, string]> = [
  ['less', 'a capture nested in a rule',
    '@buttons: selector(.btn, .button);\n.toolbar {\n  @{buttons} { margin: 0; }\n}',
    '.toolbar {\n  .btn, .button { margin: 0; }\n}'],
  ['less', 'a capture at the root',
    '@buttons: selector(.btn, .button);\n@{buttons} { margin: 0; }',
    '.btn, .button { margin: 0; }'],
  ['less', 'a list continuing a name at the root',
    '@sizes: sm, md;\n.col-@{sizes} { float: left; }',
    '.col-sm, .col-md { float: left; }'],
  ['less', 'a list continuing a name nested in a rule',
    '@sizes: sm, md;\n.row {\n  .col-@{sizes} { float: left; }\n}',
    '.row {\n  .col-sm, .col-md { float: left; }\n}'],
  ['scss', '#{&} before a BEM suffix under two parents',
    '.card, .panel {\n  #{&}__title { font-weight: bold; }\n}',
    '.card, .panel {\n  .card__title, .panel__title { font-weight: bold; }\n}'],
  ['scss', '#{&} before a BEM suffix under one parent',
    '.card {\n  #{&}__title { font-weight: bold; }\n}',
    '.card {\n  .card__title { font-weight: bold; }\n}'],
  ['jess', 'a capture nested in a rule',
    '$buttons: selector(.btn, .button);\n.toolbar {\n  ${buttons} { margin: 0; }\n}',
    '.toolbar {\n  .btn, .button { margin: 0; }\n}'],
  ['jess', 'a list continuing a name nested in a rule',
    '$sizes: sm, md;\n.row {\n  .col-${sizes} { float: left; }\n}',
    '.row {\n  .col-sm, .col-md { float: left; }\n}']
];

describe('an interpolated header with an extend elsewhere in the document', () => {
  for (const collapseNesting of [false, true]) {
    it.each(cases)(`%s: %s is written as without the extend, collapseNesting: ${collapseNesting}`, async (language, _name, source) => {
      const alone = await render(source, collapseNesting, language);
      const extend = await render(unrelated[language], collapseNesting, language);
      await expect(render(`${source}\n${unrelated[language]}`, collapseNesting, language)).resolves.toBe(alone + extend);
    });
  }

  /* Nested output writes an interpolated header's branches as the same rules written out do. */
  it.each(cases)('%s: %s is written as the rules written out', async (language, _name, source, written) => {
    const expected = await render(`${written}\n${unrelated[language]}`, false, language);
    await expect(render(`${source}\n${unrelated[language]}`, false, language)).resolves.toBe(expected);
  });
});

/*
 * Where the extend applies, the extender joins the selectors the header resolves to. In
 * nested output that is the header of the rules written out. Collapsed, it is the header
 * written with no extend, the extender added: a lone selector list under a parent stays
 * the one `:is()` unit, and a branch a list continuing a name multiplies stays its own.
 */
describe('an extend of a selector an interpolated header resolves to', () => {
  const extended: ReadonlyArray<readonly [Language, string, string, string, string]> = [
    ['less', 'a list continuing a name',
      '@sizes: sm, md;\n.col-@{sizes} { float: left; }\n.span-half:extend(.col-sm) { width: 50%; }',
      '.col-sm, .col-md { float: left; }\n.span-half:extend(.col-sm) { width: 50%; }',
      '.col-sm,\n.col-md,\n.span-half {\n  float: left;\n}\n.span-half {\n  width: 50%;\n}\n'],
    ['less', 'a list continuing a name nested in a rule',
      '@sizes: sm, md;\n.row {\n  .col-@{sizes} { float: left; }\n}\n.span-half:extend(.row .col-sm) { width: 50%; }',
      '.row {\n  .col-sm, .col-md { float: left; }\n}\n.span-half:extend(.row .col-sm) { width: 50%; }',
      '.row .col-sm,\n.row .col-md,\n.span-half {\n  float: left;\n}\n.span-half {\n  width: 50%;\n}\n'],
    ['less', 'a capture nested in a rule',
      '@buttons: selector(.btn, .button);\n.toolbar {\n  @{buttons} { margin: 0; }\n}\n.link:extend(.toolbar .btn) { color: blue; }',
      '.toolbar {\n  .btn, .button { margin: 0; }\n}\n.link:extend(.toolbar .btn) { color: blue; }',
      '.toolbar :is(.btn, .button),\n.link {\n  margin: 0;\n}\n.link {\n  color: blue;\n}\n'],
    ['less', 'a capture beside the selector an extend reaches',
      '@buttons: selector(.btn, .button);\n.toolbar {\n  @{buttons}, .link { margin: 0; }\n}\n.nav-link:extend(.toolbar .link) { color: blue; }',
      '.toolbar {\n  .btn, .button, .link { margin: 0; }\n}\n.nav-link:extend(.toolbar .link) { color: blue; }',
      '.toolbar :is(.btn, .button),\n.toolbar .link,\n.nav-link {\n  margin: 0;\n}\n.nav-link {\n  color: blue;\n}\n'],
    ['less', 'a compound continuing a name',
      '@sizes: sm, md;\n.btn.size-@{sizes} { padding: 0; }\n.btn-compact:extend(.btn.size-sm) { border: 0; }',
      '.btn.size-sm, .btn.size-md { padding: 0; }\n.btn-compact:extend(.btn.size-sm) { border: 0; }',
      '.btn.size-sm,\n.btn.size-md,\n.btn-compact {\n  padding: 0;\n}\n.btn-compact {\n  border: 0;\n}\n'],
    ['less', 'a `&` compound continuing a name',
      '@sizes: sm, md;\n.btn {\n  &.size-@{sizes} { padding: 0; }\n}\n.btn-compact:extend(.btn.size-sm) { border: 0; }',
      '.btn {\n  &.size-sm, &.size-md { padding: 0; }\n}\n.btn-compact:extend(.btn.size-sm) { border: 0; }',
      '.btn.size-sm,\n.btn.size-md,\n.btn-compact {\n  padding: 0;\n}\n.btn-compact {\n  border: 0;\n}\n'],
    ['scss', '#{&} before a BEM suffix',
      '.card, .panel {\n  #{&}__title { font-weight: bold; }\n}\n.headline { @extend .card__title; }',
      '.card, .panel {\n  .card__title, .panel__title { font-weight: bold; }\n}\n.headline { @extend .card__title; }',
      ':is(.card, .panel) :is(.card__title, .headline),\n:is(.card, .panel) .panel__title {\n  font-weight: bold;\n}\n'],
    ['jess', 'a list continuing a name',
      '$sizes: sm, md;\n.col-${sizes} { float: left; }\n.span-half { $extend .col-sm; width: 50%; }',
      '.col-sm, .col-md { float: left; }\n.span-half { $extend .col-sm; width: 50%; }',
      '.col-sm,\n.col-md,\n.span-half {\n  float: left;\n}\n.span-half {\n  width: 50%;\n}\n']
  ];

  it.each(extended)('%s: %s, nested', async (language, _name, source, written) => {
    const expected = await render(written, false, language);
    await expect(render(source, false, language)).resolves.toBe(expected);
  });

  it.each(extended)('%s: %s, collapseNesting', async (language, _name, source, _written, collapsed) => {
    await expect(render(source, true, language)).resolves.toBe(collapsed);
  });
});

/* EXTEND-SEMANTICS §10: a lone interpolation naming a selector list extends and is extended as its selectors. */
describe('a selector list a lone interpolation names, with an extend', () => {
  it.each([false, true])('extends from each of its selectors, collapseNesting: %s', async (collapseNesting) => {
    await expect(render('@buttons: selector(.btn, .button);\n.focusable { outline: auto; }\n@{buttons}:extend(.focusable) { cursor: pointer; }', collapseNesting, 'less'))
      .resolves.toBe('.focusable,\n.btn,\n.button {\n  outline: auto;\n}\n.btn,\n.button {\n  cursor: pointer;\n}\n');
  });

  it('keeps its selectors as the parent of a rule an extend flattens', async () => {
    await expect(render('@buttons: selector(.btn, .button);\n@{buttons} {\n  .icon { margin: 0; }\n}\n.badge:extend(.icon all) {}', true, 'less'))
      .resolves.toBe(':is(.btn, .button) :is(.icon, .badge) {\n  margin: 0;\n}\n');
  });
});
