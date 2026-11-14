import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

/**
 * What a block holds does not depend on which block it is. A control block's body
 * is the body any nested block has, and every nested body takes the CSS at-rules
 * Dart Sass takes there, each of which bubbles out at evaluation.
 *
 * Each source is taken from the file named beside it.
 */
const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ['@keyframes in an @if (Bootstrap _progress.scss)', '@if $enable-transitions { @keyframes progress-bar-stripes { 0% { background-position-x: 1rem; } } }'],
  ['a rule with a leading combinator in a rule in an @if (Bootstrap _grid.scss)', '@if $enable-grid-classes { .row { @include make-row(); > * { @include make-col-ready(); } } }'],
  ['a selector list of leading combinators in an @if (Bootstrap _dropdown.scss)', '.dropdown-menu { @if $dropdown-padding-y == 0 { > .dropdown-item:first-child, > li:first-child .dropdown-item { @include border-top-radius(0); } } }'],
  ['a parent selector with a child rule in an @if (Bootstrap _card.scss)', '.card { @if $enable-rounded { &:not(:last-child) { @include border-end-radius(0); > .card-img-top { border-top-right-radius: 0; } } } }'],
  ['a leading combinator in a mixin @if (Foundation _dropdown-menu.scss)', '@mixin dropdown-menu-direction($dir: horizontal) { @if $dir == horizontal { > li.opens-left { > .is-dropdown-submenu { top: 100%; } } } }'],
  ['declarations and a leading combinator in an @else (Foundation _menu.scss)', '@mixin menu-expand { @if $global-flexbox { li { flex: 1 1 0px; } } @else { display: table; > li { display: table-cell; } } }'],
  ['@extend in a rule in an @if (Bootstrap _containers.scss)', '@if ($extend-breakpoint) { .container#{breakpoint-infix($name, $grid-breakpoints)} { @extend %responsive-container-#{$breakpoint}; } }'],
  ['@font-face in a mixin', '@mixin font-face($name, $path) { @font-face { font-family: $name; src: url($path); } }'],
  ['@keyframes in a mixin', '@mixin fade { @keyframes fade { from { opacity: 0; } } }'],
  ['@keyframes in a rule', '.host { @keyframes fade { from { opacity: 0; } } }'],
  ['@font-face in @media', '@media screen { @font-face { font-family: a; } }'],
  ['a variable in @media', '@media screen { $gap: 1px; .a { gap: $gap; } }']
];

describe('SCSS statement bodies', () => {
  it.each(ACCEPTED)('accepts %s', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('keeps a @return in an @each in a function a statement, not a `result` declaration', () => {
    expect(parse('@function first($list) { @each $item in $list { @return $item; } @if $list { @return 1; } @return 2; }')).toMatchObject({
      rules: [{ value: { rules: [
        { type: 'For', rules: [{ type: 'AtRuleStatement', name: '@return' }] },
        { type: 'If', branches: [{ rules: [{ type: 'Declaration', name: 'result' }] }] },
        { type: 'Declaration', name: 'result' }
      ] } }]
    });
  });

  it('builds a rule with a leading combinator in an @if', () => {
    expect(parse('.a { @if $x { > .b { c: d; } } }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'If', branches: [{ rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'c' }] }] }] }] }]
    });
  });
});
