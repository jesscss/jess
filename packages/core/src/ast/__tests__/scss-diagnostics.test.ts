import { describe, expect, it } from 'vitest';
import { parse as parseScss } from '../../../../syntax/scss/scss-parser/src/index.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { parse as parseCss } from '../../../../syntax/css/css-parser/src/index.js';
import { parse as parseJess } from '../../../../syntax/jess/jess-parser/src/index.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';
import type { Stylesheet } from '../nodes.js';

/*
 * SCSS `@debug` / `@warn` / `@error` (G30, owner ruling 2026-09-05: "supported
 * as-is without adding to the AST. They'll add those errors/warnings/debugs I
 * guess as expected"). They reuse the generic `AtRuleStatement` node (no new AST
 * kind) and fire at EVAL: `@debug`/`@warn` report through the warning channel and
 * continue, `@error` halts. None produce CSS.
 */

const evaluator = buildEvaluator(makeLessRegistry());

interface Rendered {
  css: string;
  threw: string | null;
  warnings: Array<{ code: string; message: string }>;
}

function renderRoot(root: Stylesheet, collapseNesting?: boolean): Rendered {
  const context = new Context();
  context.registerValueEvaluator(evaluator);
  let css = '';
  let threw: string | null = null;
  try {
    css = serialize(root, { context, collapseNesting }).css;
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  return {
    css,
    threw,
    warnings: context.warnings.map(w => ({ code: w.code, message: w.message }))
  };
}

function render(src: string, collapseNesting?: boolean): Rendered {
  return renderRoot(parseScss(src), collapseNesting);
}

describe('SCSS diagnostic directives', () => {
  it('@debug reports through the warning channel and emits no CSS', () => {
    const out = render('@debug "hello";');
    expect(out.threw).toBeNull();
    expect(out.css).toBe('');
    expect(out.warnings).toEqual([{ code: 'eval/scss-debug', message: 'hello' }]);
  });

  it('@warn reports through the warning channel and emits no CSS', () => {
    const out = render('@warn "careful";');
    expect(out.threw).toBeNull();
    expect(out.css).toBe('');
    expect(out.warnings).toEqual([{ code: 'eval/scss-warn', message: 'careful' }]);
  });

  it('@error halts with an eval error carrying the message', () => {
    const out = render('@error "boom";');
    expect(out.threw).toContain('boom');
    expect(out.warnings).toEqual([]);
  });

  it('@error halts the render — statements after it never emit', () => {
    const out = render('.a { color: red; }\n@error "stop";\n.b { color: blue; }');
    expect(out.threw).toContain('stop');
    expect(out.css).not.toContain('.b');
  });

  it('evaluates the message like a Sass value (arithmetic and interpolation)', () => {
    expect(render('@debug 1 + 2;').warnings).toEqual([
      { code: 'eval/scss-debug', message: '3' }
    ]);
    expect(render('$who: "world";\n@warn "hi #{$who}";').warnings).toEqual([
      { code: 'eval/scss-warn', message: 'hi world' }
    ]);
  });

  /*
   * Unquoting is STRUCTURAL: only a top-level single string reports its
   * unquoted text. A list keeps its element quotes — a byte-level
   * `stripOuterQuotes` over the serialized message would wrongly unwrap
   * `"a", "b"` to `a", "b`.
   */
  it('unquotes only a top-level single string, not a list', () => {
    expect(render('@debug "solo";').warnings).toEqual([
      { code: 'eval/scss-debug', message: 'solo' }
    ]);
    const list = render('@debug "a", "b";').warnings;
    expect(list).toHaveLength(1);
    expect(list[0]!.code).toBe('eval/scss-debug');
    expect(list[0]!.message).toContain('"a"');
    expect(list[0]!.message).toContain('"b"');
  });

  it('only fires from the taken @if branch', () => {
    const taken = render('@if true { @warn "yes"; } @else { @error "no"; }');
    expect(taken.threw).toBeNull();
    expect(taken.warnings).toEqual([{ code: 'eval/scss-warn', message: 'yes' }]);

    const halts = render('@if false { @warn "yes"; } @else { @error "no"; }');
    expect(halts.threw).toContain('no');
  });

  /*
   * serialize.ts still carries TWO evaluators (the nested `emitNestedBody` path
   * and the flatten walker); a diagnostic inside a selector context exercises the
   * flatten path's `staysNested` branch, which does not funnel through
   * `emitAtRuleStatement`. Assert the two emit forms agree until the fold lands.
   */
  it('nested and collapsed emit forms agree for @warn in a ruleset', () => {
    const nested = render('.a { @warn "w"; color: red; }', false);
    const collapsed = render('.a { @warn "w"; color: red; }', true);
    expect(nested.css).toBe('.a {\n  color: red;\n}\n');
    expect(collapsed.css).toBe(nested.css);
    expect(nested.warnings).toEqual([{ code: 'eval/scss-warn', message: 'w' }]);
    expect(collapsed.warnings).toEqual(nested.warnings);
  });

  it('nested and collapsed emit forms agree for @error in a ruleset (both halt)', () => {
    const nested = render('.a { @error "e"; color: red; }', false);
    const collapsed = render('.a { @error "e"; color: red; }', true);
    expect(nested.threw).toContain('e');
    expect(collapsed.threw).toContain('e');
  });
});

/*
 * The diagnostic routing is gated on a marker the SCSS grammar sets, NOT on the
 * at-rule name — the serializer is shared across all four dialects. In CSS,
 * Less, and jess these names are ordinary UNKNOWN at-rules and MUST keep the
 * verbatim unknown-at-rule passthrough (P2): no drop, no warn, and — the
 * regression this pins — no compile-halt on `@error`. G30's owner ruling is
 * SCSS/Sass-scoped; .jess is pending its own owner ruling and stays passthrough
 * for now.
 */
describe('non-SCSS dialects keep @debug/@warn/@error as verbatim passthrough', () => {
  const dialects: Array<[string, (src: string) => Stylesheet]> = [
    ['CSS', parseCss as (src: string) => Stylesheet],
    ['Less', parseLess as (src: string) => Stylesheet],
    ['jess', parseJess as (src: string) => Stylesheet]
  ];
  for (const [name, parse] of dialects) {
    for (const directive of ['@debug', '@warn', '@error']) {
      it(`${name} emits ${directive} verbatim and does not halt`, () => {
        const out = renderRoot(parse(`${directive} "x";`));
        expect(out.threw, `${name} ${directive} must not halt`).toBeNull();
        expect(out.css).toBe(`${directive} "x";\n`);
        expect(out.warnings).toEqual([]);
      });
    }
  }
});
