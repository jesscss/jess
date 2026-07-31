import { parse } from '../../packages/syntax/scss/scss-parser/lib/index.js';

const cases = [
  'a {b: f($x: 1)}',
  'a {b: f(1, $x: 2)}',
  'a {b: f($x...)}',
  'a {b: ns.f($x: 1)}'
];

for (const src of cases) {
  try {
    parse(src);
    console.log('OK  ', JSON.stringify(src));
  } catch (e) {
    console.log('FAIL', JSON.stringify(src), '::', String(e.message).slice(0, 80));
  }
}
