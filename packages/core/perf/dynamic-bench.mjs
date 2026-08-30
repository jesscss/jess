// Dynamic (eval-heavy: mixin calls + operations + references) render bench.
import { Compiler } from '../../jess/lib/index.js';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
let src = `@base: 10px; @c1: #336699; @c2: #99ccff;\n.mx(@n,@col) when (@n>0){ pad-@{n}:(@n*@base); color:lighten(@col,(@n*2%)); .inner{ margin:(@base+@n); border-color:darken(@col,5%);} }\n`;
for (let i = 1; i <= 1200; i++) {
  src += `.block-${i}{ .mx(${i % 20 + 1},@c${(i % 2) + 1}); width:(@base*${i % 10 + 1}); color:mix(@c1,@c2,${i % 100}%);}\n`;
}
const p = join(here, 'dyn.less');
writeFileSync(p, src);
const t = [];
for (let i = 0; i < 3; i++) {
  await new Compiler().render(p, { output: { collapseNesting: false } });
}
for (let i = 0; i < 25; i++) {
  const a = performance.now();
  await new Compiler().render(p, { output: { collapseNesting: false } });
  t.push(performance.now() - a);
}
t.sort((x, y) => x - y);
console.log(`dynamic (mixin/refs): median ${t[t.length >> 1].toFixed(1)}ms (min ${t[0].toFixed(1)}, max ${t[t.length - 1].toFixed(1)})`);
