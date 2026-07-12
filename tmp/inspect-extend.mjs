import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Parser } from '../packages/less-parser/lib/index.js';
import { Context } from '../packages/core/lib/context.js';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));
const lessPath = path.join(testData, 'tests-unit/extend/extend.less');
const src = readFileSync(lessPath, 'utf8');
const context = new Context({ collapseNesting: false, leakyRules: true });
const parser = new Parser();
const { tree } = parser.parse(src, 'stylesheet', { context });
console.log('rootType', tree?.type);
console.log('rootHasValue', Array.isArray(tree?.value), typeof tree?.value, tree?.value?.length);

function walk(node, out = []) {
  if (node == null || typeof node !== 'object') return out;
  if (node.type === 'Ruleset') {
    const sel = node.value?.selector?.valueOf?.() ?? node.value?.selector;
    const rules = node.value?.rules?.value ?? [];
    out.push({
      selector: String(sel),
      ruleTypes: rules.map((r) => r?.type),
      extends: rules
        .filter((r) => r?.type === 'Extend')
        .map((r) => ({
          flag: r.value?.flag,
          targetType: r.value?.target?.type,
          target: r.value?.target?.valueOf?.() ?? String(r.value?.target),
          targetItems: r.value?.target?.value?.map?.((x) => x?.valueOf?.() ?? String(x))
        }))
    });
  }
  const vals = [];
  if (Array.isArray(node.value)) vals.push(...node.value);
  if (node.value?.rules?.value) vals.push(...node.value.rules.value);
  for (const child of vals) walk(child, out);
  return out;
}

console.log(JSON.stringify(walk(tree), null, 2));
