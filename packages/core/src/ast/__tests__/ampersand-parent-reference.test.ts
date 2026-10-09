import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize } from '../serialize.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';

/*
 * A `&` with a selector glued in front of it (`.active&`) does not build a name: it is a
 * plain reference to the parent, which follows CSS nesting, `.active:is(parent)` (owner
 * 2026-10-09). Name building (`&__el`, `&-x`) still glues onto the parent's last compound.
 *
 * Under a parent of several compounds, the compound that opens the selector writes the
 * parent in place, its other simples joined to the parent's LAST compound (the meaning
 * and specificity of `:is(parent)`); anywhere else the parent stays one `:is(parent)`
 * unit, since `.c .a .b` is not `.c :is(.a .b)`. Extend composes the same selector
 * (ledger X5): every case is checked on the rule's own flattened header and on the
 * header an `&:extend(.t)` in it writes into `.t`.
 */
const evaluator = buildEvaluator(makeLessRegistry());
const flat = (src: string): string => String(serialize(parseLess(src), { evaluator, collapseNesting: true }).css);

/** The rule's own header and the extender `.t` receives, for `child` nested under `parent`. */
function headers(parent: string, child: string): { own: string; extended: string } {
  const css = flat(`.t { m: 1 } ${parent.replace('K', `${child} { n: 1; &:extend(.t); }`)}`);
  const extended = /^\.t,\n([^{]*) \{\n {2}m: 1;/.exec(css)?.[1]?.replace(/,\n/g, ', ') ?? css;
  const own = /\n([^{}\n][^{}]*) \{\n {2}n: 1;/.exec(css)?.[1]?.replace(/,\n/g, ', ') ?? css;
  return { own, extended };
}

const POSITIONS: ReadonlyArray<readonly [child: string, written: string]> = [
  // The `&` opens the selector: the parent is written in place.
  ['&', '.a .b'],
  ['&.x', '.a .b.x'],
  ['&::before', '.a .b::before'],
  ['& > .c', '.a .b > .c'],
  ['&-sfx', '.a .b-sfx'],
  ['&__el', '.a .b__el'],

  // A selector glued in front of the `&` joins the parent's last compound.
  ['.x&', '.a .b.x'],
  ['.x&.y', '.a .b.x.y'],
  ['div&', '.a div.b'],
  ['.x&-sfx', '.a .b-sfx.x'],

  // Anywhere else the parent is one unit.
  ['.c &', '.c :is(.a .b)'],
  ['.c > &', '.c > :is(.a .b)'],
  ['.c &.x', '.c :is(.a .b).x'],
  ['.c .x&', '.c .x:is(.a .b)'],
  ['.c &-sfx', '.c :is(.a .b-sfx)'],
  ['> &', '> :is(.a .b)'],
  ['& + &', '.a .b + :is(.a .b)'],
  ['& &', '.a .b :is(.a .b)'],
  ['&&', '.a .b:is(.a .b)'],
  ['& + .y&', '.a .b + .y:is(.a .b)'],

  // A pseudo's selector argument is a selector of its own.
  ['.x:not(&)', '.x:not(.a .b)'],
  [':not(.c &)', ':not(.c :is(.a .b))'],
  [':not(.x&)', ':not(.a .b.x)'],
  [':is(&) .y', ':is(.a .b) .y'],
  ['.x:is(.c &)', '.x:is(.c :is(.a .b))']
];

describe('a `&` is a plain reference to a parent of several compounds', () => {
  for (const parent of ['.a { .b { K } }', '.a .b { K }']) {
    for (const [child, written] of POSITIONS) {
      it(`writes \`${child}\` under ${parent.replace(' K ', ' … ')} as \`${written}\`, flattened and extended`, () => {
        expect(headers(parent, child)).toEqual({ own: written, extended: written });
      });
    }
  }

  it('keeps the parent one unit where its last compound and the glued simple both name an element', () => {
    expect(headers('.a span { K }', 'div&')).toEqual({ own: 'div:is(.a span)', extended: 'div:is(.a span)' });
  });

  it('writes a single-compound parent as before', () => {
    expect(headers('.a { K }', '.x&')).toEqual({ own: '.x.a', extended: '.x.a' });
    expect(headers('.a { K }', '.c &')).toEqual({ own: '.c .a', extended: '.c .a' });
    expect(headers('.a.b { K }', '& + &')).toEqual({ own: '.a.b + .a.b', extended: '.a.b + .a.b' });
  });

  it('writes each complex parent of a list by the same rule', () => {
    expect(headers('.a, .c .d { K }', '.x&').own).toBe('.x.a, .c .d.x');
    expect(headers('.a, .c .d { K }', '.z .x&').own).toBe('.z .x.a, .z .x:is(.c .d)');
  });

  it('is matched by extend as written', () => {
    expect(flat('.a { .b { .x& { m: 1 } } } .z:extend(.a .b.x) {}')).toBe('.a .b.x,\n.z {\n  m: 1;\n}\n');
    expect(flat('.a { .b { .c & { m: 1 } } } .z:extend(.c :is(.a .b)) {}')).toBe('.c :is(.a .b),\n.z {\n  m: 1;\n}\n');
  });

  // The selectors and extend-nest corpus cases (owner-accepted 2026-10-09).
  it('writes the corpus extenders', () => {
    expect(flat('.extend-this { c: 1 } .first-level { .second-level { .active&:extend(.extend-this) {} &.active2:extend(.extend-this) {} } }'))
      .toBe('.extend-this,\n.first-level .second-level.active,\n.first-level .second-level.active2 {\n  c: 1;\n}\n');
    const x = ':is(.amp-test-a, .amp-test-b).amp-test-d:is(.amp-test-a, .amp-test-b).amp-test-e';
    expect(flat('.amp-test-a, .amp-test-b { .amp-test-c &.amp-test-d&.amp-test-e { .amp-test-f&+&.amp-test-g:extend(.amp-test-h) {} } } .amp-test-h { t: 1 }'))
      .toBe(`.amp-test-h,\n.amp-test-c ${x}.amp-test-f + :is(.amp-test-c ${x}).amp-test-g {\n  t: 1;\n}\n`);
  });

  it('keeps a complex alternative an extend splits out of a one-unit parent wrapped', () => {
    expect(flat('.a .b { .c & { m: 1 } } #z:extend(.a all) {}'))
      .toBe('.c :is(.a .b),\n.c :is(#z .b) {\n  m: 1;\n}\n');
  });
});
