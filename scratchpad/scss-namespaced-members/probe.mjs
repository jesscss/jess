import { parse } from '../../packages/syntax/scss/scss-parser/lib/index.js';

const cases = [
  'a {b: ns.f(1)}',
  '@use "sass:color";\na {b: color.mix(red, blue)}',
  'a {b: ns.$var}',
  '$x: math.$pi;',
  'a {b: map.get($m, k)}',
  'a {b: map-get($m, k)}',
  'a {b: url(x.png)}',
  'a {b: foo.bar}',
  'a {b: 1.5px}',
  'a {b: color.adjust($c, $lightness: 10%)}',
  '@each $x in list.append($a, $b) {c {d: $x}}',
  'a {b: #{ns.f(1)}}',
  'a {b: ns.f(1) ns.$v}',
  '@include ns.m;',
  '@use "a" with ($b: c);'
];

for (const src of cases) {
  try {
    const tree = parse(src);
    console.log('OK  ', JSON.stringify(src));
    if (process.env.DUMP) {
      console.log(JSON.stringify(tree.rules, null, 1).slice(0, 1400));
    }
  } catch (e) {
    console.log('FAIL', JSON.stringify(src), '::', String(e.message).slice(0, 90));
  }
}
