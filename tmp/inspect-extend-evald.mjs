import { Parser } from '../packages/less-parser/lib/index.js';
import { Context } from '../packages/core/lib/context.js';

const source = `
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
`;

const context = new Context({ collapseNesting: false, leakyRules: true });
const parser = new Parser();
const { tree } = parser.parse(source, 'stylesheet', { context });
const evald = await tree.eval(context);

function walkRulesets(node, out = []) {
  if (node == null || typeof node !== 'object') return out;
  if (node.type === 'Ruleset') {
    out.push({
      selector: node.value?.selector?.valueOf?.() ?? String(node.value?.selector),
      ownSelector: node.options?.ownSelector?.valueOf?.() ?? (node.options?.ownSelector ? String(node.options.ownSelector) : undefined),
      parent: node.parent?.parent?.type === 'Ruleset'
        ? node.parent.parent.value?.selector?.valueOf?.() ?? String(node.parent.parent.value?.selector)
        : undefined
    });
  }
  const vals = [];
  if (Array.isArray(node.value)) vals.push(...node.value);
  if (node.value?.rules?.value) vals.push(...node.value.rules.value);
  for (const child of vals) walkRulesets(child, out);
  return out;
}

console.log(JSON.stringify(walkRulesets(evald), null, 2));
