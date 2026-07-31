import { parse } from '../../packages/syntax/scss/scss-parser/lib/index.js';

const cases = [
  ['leading class', '.#{$x} { c: d }'],
  ['element prefix', 'a#{$x} { c: d }'],
  ['whole compound', '#{$x} { c: d }'],
  ['then combinator', '#{$x} .b { c: d }'],
  ['then suffix', '#{$x}-y { c: d }'],
  ['two interps', '#{$a} #{$b} { c: d }'],
  ['interp > class', '#{$a} > .b { c: d }'],
  ['interp pseudo', '#{$selector}:first-child { c: d }'],
  ['quoted interp', "#{'.foo'} { c: d }"],
  ['call interp', "#{data('bar')} { c: d }"],
  ['parent interp', '#{&} { c: d }'],
  ['double parent', '#{&}--foo#{&}--bar { c: d }'],
  ['nested interp start', 'a { #{$x} { c: d } }'],
  ['at-root interp', 'a { @at-root #{&} { c: d } }'],
  ['id selector', '#foo { c: d }'],
  ['interp in list', '.a, #{$x} { c: d }'],
  ['interp decl name', 'a { #{$x}: d }']
];

for (const [label, src] of cases) {
  try {
    parse(src);
    console.log('OK   ', label.padEnd(22), JSON.stringify(src));
  } catch (e) {
    console.log('FAIL ', label.padEnd(22), JSON.stringify(src), '::', String(e.message).slice(0, 70));
  }
}
