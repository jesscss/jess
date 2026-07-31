/*
 * Diff the CST node names a candidate grammar emits against the incumbent's,
 * AFTER the cst-host's own remapping. The host is what the identity gate sees,
 * so a raw production-name diff is not the answer -- TYPE_NAMES and
 * publicGrammarType both rewrite names on the way out.
 *
 * usage: node name-diff.mjs <candidate-grammar.ts>
 */
import { readFileSync } from 'node:fs';

/* node('Name', ...) on one line, or `= node(` with the name on the next. */
function nodeNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/node(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) {
    names.add(m[1]);
  }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (/=\s*node(?:<[^>]*>)?\($/.test(lines[i])) {
      const m = /^\s*'([A-Za-z]+)'/.exec(lines[i + 1]);
      if (m) {
        names.add(m[1]);
      }
    }
  }
  return names;
}

/* cst-host.ts publicGrammarType, transcribed. Keys off grammarType only. */
const RETYPE = {
  Numeric: '<Percentage|Dimension|Num by children>',
  Dimension: '<Percentage|Dimension|Num by children>',
  BasicSelector: '<Class|Id|Type|Universal|Basic by children>',
  ConditionalBlock: 'QueryAtRuleBlock',
  NestedConditionalBlock: 'QueryAtRuleBlock',
  LayerStatement: 'AtRuleStatement',
  TopLevelRuleset: 'Ruleset',
  TopLevelSelectorList: 'SelectorList',
  PunctuationValue: 'DeclarationAny',
  NonIdentifierPunctuationValue: 'DeclarationAny',
  ParenValue: 'DeclarationParen',
  RawParenValue: 'DeclarationRawParen',
  TopLevelComplexSelector: 'ComplexSelector',
  TopLevelCompoundSelector: 'CompoundSelector'
};

/* cst-host.ts TYPE_NAMES, transcribed. Applied AFTER publicGrammarType. */
const TYPE_NAMES = {
  Stylesheet: 'StyleSheet',
  Ruleset: 'QualifiedRule',
  AtRuleBlock: 'AtRule',
  AtRuleStatement: 'AtRule',
  UnknownAtRuleBlock: 'AtRule',
  QueryAtRuleBlock: 'QueryAtRule',
  Declaration: 'Declaration',
  CustomDeclaration: 'Declaration',
  Num: 'Number',
  Call: 'Function',
  Paren: 'SimpleBlock',
  Quoted: 'String'
};

function publicName(g) {
  const retyped = RETYPE[g];
  if (retyped !== undefined) {
    return retyped.startsWith('<') ? retyped : (TYPE_NAMES[retyped] ?? retyped);
  }
  return TYPE_NAMES[g] ?? g;
}

const incumbent = nodeNames(readFileSync(new URL('../src/grammar.ts', import.meta.url), 'utf8'));
const candidate = nodeNames(readFileSync(process.argv[2], 'utf8'));

if (incumbent.size < 50) {
  throw new Error(`incumbent name extraction returned ${incumbent.size} -- parser is broken, not the grammar`);
}

const incPublic = new Map();
for (const n of incumbent) {
  incPublic.set(publicName(n), n);
}

console.log(`incumbent productions: ${incumbent.size}   candidate: ${candidate.size}\n`);
console.log('CANDIDATE NAMES WITH NO INCUMBENT COUNTERPART (emitted CST type differs):');
let bad = 0;
for (const n of [...candidate].sort()) {
  const pub = publicName(n);
  if (!incPublic.has(pub)) {
    bad++;
    const note = RETYPE[n] ? '  [host retypes this]' : TYPE_NAMES[n] ? '  [TYPE_NAMES maps this]' : '';
    console.log(`  ${n.padEnd(26)} -> emits ${String(pub).padEnd(30)}${note}`);
  }
}
if (bad === 0) {
  console.log('  (none)');
}
console.log(`\n${bad} candidate production name(s) emit a CST type the incumbent never emits.`);
