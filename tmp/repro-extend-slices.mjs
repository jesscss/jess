import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Parser } from '../packages/less-parser/lib/index.js';
import { Context } from '../packages/core/lib/context.js';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));
const lessPath = path.join(testData, 'tests-unit/extend/extend.less');
const full = readFileSync(lessPath, 'utf8');

const slices = [
  {
    name: 'tail-only',
    source: `
.aa {
  color: black;
  .dd { background: red; }
}
.bb {
  background: red;
  .bb { color: black; }
}
.cc:extend(.aa,.bb) {}
.ee:extend(.dd all,.bb) {}
.ff:extend(.dd,.bb all) {}
`
  },
  {
    name: 'foo-block-plus-tail',
    source: `
.foo .bar, .foo .baz {
  display: none;
}
.ext1 .ext2 {
  &:extend(.foo all);
}
.ext3,
.ext4 {
  &:extend(.foo all);
  &:extend(.bar all);
}

.aa {
  color: black;
  .dd { background: red; }
}
.bb {
  background: red;
  .bb { color: black; }
}
.cc:extend(.aa,.bb) {}
.ee:extend(.dd all,.bb) {}
.ff:extend(.dd,.bb all) {}
`
  },
  {
    name: 'full-file',
    source: full
  }
];

for (const slice of slices) {
  const context = new Context({ collapseNesting: false, leakyRules: true });
  const parser = new Parser();
  const { tree } = parser.parse(slice.source, 'stylesheet', { context });
  const evald = await tree.eval(context);
  const css = evald.toString({ context });
  const marker = '.aa,\n.cc';
  const i = css.indexOf(marker);
  console.log(`\n## ${slice.name}`);
  console.log(css.slice(i, i + 220));
}
