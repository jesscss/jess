import { beforeAll, describe, expect, it } from 'vitest';
import { cstOutcome, ENGINES, loadEnginePair, outcome, type Engine } from './engine-parity.js';

/**
 * A `--`-led name in a selector, as every dialect reads it: `--b` is an ident
 * (css-syntax-3 §4.3.9), so `.--b` and `#--b` are a class and an id (selectors-4
 * §3.2) and `:--heading` a custom selector's use (css-extensions-1
 * `<custom-selector>`). Each dialect's test runs these and its own through the
 * built macro-compiled and interpreter bundles.
 */
export const CSS_DASHED_NAMES = [
  '.--b { color: red; }',
  '#--b { color: red; }',
  '.a.--b { color: red; }',
  '.a#--b { color: red; }',
  'a.--b { color: red; }',
  '.--b.a { color: red; }',
  '.c .--b { color: red; }',
  '.c > .--b { color: red; }',
  '.c, .--b { color: red; }',
  '.--b:hover { color: red; }',
  '.--b::before { color: red; }',
  '.--b[x] { color: red; }',
  '.--b-c__d { color: red; }',
  ':not(.--b) { color: red; }',
  ':is(.--b, .c) { color: red; }',
  ':where(#--b) { color: red; }',
  ':has(> .--b) { color: red; }',
  ':host(.--b) { color: red; }',
  '::slotted(.--b) { color: red; }',
  'li:nth-child(2n of .--b) { color: red; }',
  ':--heading { color: red; }',
  'a:--heading { color: red; }',
  ':--heading > a { color: red; }',
  ':--heading, a { color: red; }',
  ':not(:--heading) { color: red; }',
  '.c { .--b { color: red; } }',
  '.c { #--b { color: red; } }',
  '.c { &.--b { color: red; } }',
  '.c { & .--b { color: red; } }',
  '.c { > .--b { color: red; } }',
  '.c { :--heading { color: red; } }',
  '@media (min-width: 1px) { .--b { color: red; } }',
  '@scope (.--b) to (.c) { a { color: red; } }',
  '@supports selector(.--b) { .c { color: red; } }'
];

export function describeDashedNames(
  dialect: string,
  libDir: string,
  parse: (grammar: Record<string, unknown>, source: string) => unknown,
  select: readonly string[],
  own: readonly string[] = []
): void {
  describe.each(ENGINES)(`${dialect}, %s build`, (engine: Engine) => {
    let ast: Record<Engine, Record<string, unknown>>;
    let cst: Record<Engine, Record<string, unknown>>;

    beforeAll(async () => {
      ast = await loadEnginePair(libDir, 'ast');
      cst = await loadEnginePair(libDir, 'cst');
    });

    it.each([...CSS_DASHED_NAMES, ...own])('%s', (source) => {
      expect(outcome(() => parse(ast[engine], source))).toMatchObject({ ok: true });
      expect(cstOutcome(cst[engine], source, select)).toMatchObject({ ok: true, value: { ok: true } });
    });
  });
}
