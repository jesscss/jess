/**
 * CST NAME PRECONDITION — the identity gate never sees a production name.
 *
 * In `hostMode: 'cst'` the grammar's reducers do not run. parseman builds each
 * node by calling a `ctx.build` host, and THAT HOST IS GRAMMAR-OWNED, not
 * parseman's: `packages/syntax/css/css-parser/src/cst-host.ts`. Before a node
 * reaches the tree the host has already
 *
 *   - retyped it from its CHILDREN (`publicGrammarType`): one `Numeric`
 *     production surfaces as `Percentage`, `Dimension` or `Num`;
 *   - remapped its name through `TYPE_NAMES` (`publicTypeName`);
 *   - and in two cases FABRICATED children no production emits
 *     (`publicChildren`: the joined `name(` leaf for `Url`, the shifted leaf
 *     for `Quoted`).
 *
 * So a raw production-name diff answers the wrong question. A candidate that
 * renames `ParenValue` to `Group` looks harmless in source and emits a CST type
 * the incumbent never emits. This check applies the host's own two rewrites
 * BEFORE diffing, which is the only form of the question the gate can act on.
 *
 * It self-tests: run against the incumbent it must report zero. A name checker
 * that cannot go red is not a check, and an absent column reads as clean.
 */
import { readFileSync } from 'node:fs';

/* cst-host.ts publicGrammarType. Keys off grammarType; '<' marks child-decided. */
const RETYPE = {
  Numeric: '<by-children>',
  Dimension: '<by-children>',
  BasicSelector: '<by-children>',
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

/* cst-host.ts TYPE_NAMES, applied AFTER publicGrammarType. */
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

/**
 * Every name passed to `node(...)`, in both authoring forms these grammars use
 * — `node('Name', …)` inline, and `= node(` with the name on the next line —
 * and with the OPTIONAL GENERIC (`node<Quoted>('Name', …)`) allowed for. css
 * uses no generics; scss (158) and jess (178) do, so a pattern without it
 * silently returns almost nothing on those files.
 */
export function nodeNames(src) {
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

function publicName(g) {
  const retyped = RETYPE[g];
  if (retyped !== undefined) {
    return retyped.startsWith('<') ? retyped : (TYPE_NAMES[retyped] ?? retyped);
  }
  return TYPE_NAMES[g] ?? g;
}

/**
 * @returns {{ ok: boolean, extra: string[], reason?: string }}
 *   `extra` lists candidate productions whose emitted CST type has no
 *   incumbent counterpart. Non-empty is a finding, not automatically a refusal
 *   — a candidate may legitimately be mid-build — so the caller decides.
 */
export function checkNames(baseGrammarFile, candidateGrammarFile) {
  const base = nodeNames(readFileSync(baseGrammarFile, 'utf8'));
  if (base.size < 50) {
    return { ok: false, extra: [], reason: `name extraction returned ${base.size} names for the incumbent — the extractor is broken, not the grammar` };
  }
  const candidate = nodeNames(readFileSync(candidateGrammarFile, 'utf8'));

  const basePublic = new Set([...base].map(publicName));
  const extra = [...candidate]
    .filter(n => !basePublic.has(publicName(n)))
    .sort()
    .map(n => `${n} -> emits ${publicName(n)}`);

  return { ok: extra.length === 0, extra, checked: base.size };
}
