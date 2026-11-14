#!/usr/bin/env node
/**
 * HOT-PATH ANTIPATTERN inventory check.
 *
 * Runs the `eslint.hotpath.config.mjs` pass and compares the findings against
 * a committed NAMED SET of known sites. The set only shrinks: a new site fails,
 * and so does an entry whose site is gone — prune it with `--write-inventory`
 * in the same commit as the fix. That is the whole contract.
 *
 * WHY A NAMED SET AND NOT A COUNT. This repo's standing rule is that a baseline
 * names its members. A bare number cannot distinguish "nothing changed" from
 * "you fixed one and introduced another", which is precisely the failure mode
 * this check exists to close — the class of defect it targets is invisible to
 * every output-comparing gate, so a self-cancelling count would restore the
 * exact blind spot.
 *
 * KEYS ARE CONTENT-ADDRESSED, NOT LINE-ADDRESSED. An entry is
 * `file + rule + sha1(normalized snippet) + ordinal`. Inserting a line above a
 * site does not invalidate its entry, and editing the site's own text does —
 * which is correct: a rewritten site is a new site and deserves a fresh look.
 *
 * CI runs it (`pnpm verify:hot-path`) in the "Build · lint · types · tests ·
 * gates" job. See `docs/perf/HOT-PATH-ANTIPATTERN-GATE.md`.
 *
 * Usage:
 *   node scripts/verify-hot-path-antipatterns.mjs            compare (exit 1 on a new site or a stale entry)
 *   node scripts/verify-hot-path-antipatterns.mjs --report   print every finding, always exit 0
 *   node scripts/verify-hot-path-antipatterns.mjs --write-inventory
 *                                                            deletion-only prune of stale entries
 *   node scripts/verify-hot-path-antipatterns.mjs --write-inventory --seed
 *                                                            create/replace (reviewed edit)
 */
import './eslint-rules/typescript6-shim.mjs';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = resolve(root, 'scripts/hot-path-antipattern-inventory.json');
const configPath = resolve(root, 'eslint.hotpath.config.mjs');

const TARGETS = [
  'packages/core/src/ast/**/*.ts',
  'packages/syntax/css/css-parser/src/**/*.ts',
  'packages/syntax/less/less-parser/src/**/*.ts',
  'packages/syntax/scss/scss-parser/src/**/*.ts',
  'packages/syntax/jess/jess-parser/src/**/*.ts'
];

const INVENTORY_VERSION = 1;

const POLICY = 'Every entry is a KNOWN hot-path antipattern site, not an exemption. '
  + 'The gate is satisfied by shrinking this set; it never grows without a reviewed edit. '
  + 'The final state is sites: [].';

/**
 * Files whose findings are recorded but explicitly OWNED by in-flight work, so
 * that a reader of the inventory does not mistake a listed site for an accepted
 * one. Purely descriptive — it changes no comparison outcome.
 */
const OWNERSHIP = {
  'packages/core/src/ast/serialize.ts': 'comment/trivia replay rewrite in flight',
  'packages/core/src/ast/provenance.ts': 'provenance side-map rewrite in flight'
};

/**
 * Findings that are correct code, each named with its reason. Matched by
 * content (`file + rule + normalized snippet`, as inventory sites are), so an
 * exception holds whether or not the detector currently reaches its site: a
 * detector that loses a blind spot must not turn an accepted site into a new
 * one. An excepted finding never enters the comparison or the inventory;
 * `--report` lists it with its reason.
 */
const EXCEPTIONS = [
  ...['text.indexOf(\'e\')', 'text.slice(0, e)', 'text.slice(e + 1)'].map(snippet => ({
    file: 'packages/core/src/ast/decimal.ts',
    rule: 'no-source-text-rescan',
    snippet,
    reason: 'The receiver is String(n), the shortest decimal spelling of an operand double, not source text: '
      + 'an operand is often a computed value the parser never saw, so there is no node fact to read. '
      + 'Exact base-10 arithmetic (ledger V6) needs that spelling; each operation reads one string of at most 24 characters once.'
  })),
  {
    file: 'packages/core/src/ast/serialize.ts',
    rule: 'no-loop-invariant-accessor',
    snippet: 'composed.slice()',
    reason: 'expandCall copies the composed parent selectors once per mixin expansion on purpose: '
      + 'each expansion needs a fresh array identity, so nested rulesets from two separate calls '
      + 'of one mixin body stay two blocks instead of merging. Hoisting the copy above the loop '
      + 'would share one identity across calls.'
  },
  {
    file: 'packages/core/src/ast/extend/compose.ts',
    rule: 'no-loop-invariant-accessor',
    snippet: 'value.slice()',
    reason: 'withNamesJoined copies one compound\'s simples only when it joins a `&` to the name after it, '
      + 'then breaks out of the inner loop: one copy per changed compound, which the following splice mutates.'
  },
  {
    file: 'packages/core/src/ast/nodes.ts',
    rule: 'no-rescan-in-loop',
    snippet: 'text.indexOf(PLACEHOLDER_SIGIL, at + 2)',
    reason: 'branchTextIsPlaceholder advances a cursor past each sigil it finds, so the scan reads each '
      + 'character once in total. The receiver is a string, not a collection the rule can hoist into a Set.'
  },
  {
    file: 'packages/core/src/ast/serialize.ts',
    rule: 'no-rescan-in-loop',
    snippet: 'text.indexOf(\'\\n\', at)',
    reason: 'Inlined-import source mapping splits the text into lines with a cursor that moves past each '
      + 'newline, so the scan reads each character once in total. The receiver is a string, not a collection.'
  }
];

export function exceptionFor(finding) {
  return EXCEPTIONS.find(x => x.file === finding.file && x.rule === finding.rule && x.snippet === finding.snippet);
}

function normalize(text) {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function fingerprint(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function siteKey(entry) {
  return `${entry.file}\0${entry.rule}\0${entry.fingerprint}\0${entry.ordinal}`;
}

/** Byte offset of a 1-based line / 1-based column in `text`. */
function offsetOf(lineStarts, line, column) {
  return lineStarts[line - 1] + (column - 1);
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

async function collectFindings() {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: configPath,

    // The hot-path pass is self-contained; the default config must not merge in.
    flags: []
  });
  const results = await eslint.lintFiles(TARGETS.map(t => resolve(root, t)));

  const sources = new Map();
  const perFileRuleOrdinal = new Map();
  const findings = [];

  for (const result of results) {
    const file = relative(root, result.filePath).replaceAll('\\', '/');
    for (const message of result.messages) {
      /*
       * Only this pass's rules. A stray inline `/* eslint *\/` directive in a
       * source file can enable an unrelated rule; that is not our business.
       */
      if (typeof message.ruleId !== 'string' || !message.ruleId.startsWith('hotpath/')) {
        continue;
      }
      if (!sources.has(file)) {
        const text = readFileSync(result.filePath, 'utf8');
        sources.set(file, { text, lineStarts: lineStartsOf(text) });
      }
      const { text, lineStarts } = sources.get(file);
      const start = offsetOf(lineStarts, message.line, message.column);
      const end = message.endLine === undefined
        ? start
        : offsetOf(lineStarts, message.endLine, message.endColumn);
      const snippet = normalize(text.slice(start, Math.max(end, start))).slice(0, 200);
      const rule = message.ruleId.slice('hotpath/'.length);

      const ordinalKey = `${file}\0${rule}\0${fingerprint(snippet)}`;
      const ordinal = perFileRuleOrdinal.get(ordinalKey) ?? 0;
      perFileRuleOrdinal.set(ordinalKey, ordinal + 1);

      findings.push({
        file,
        rule,
        fingerprint: fingerprint(snippet),
        ordinal,
        snippet,
        line: message.line,
        message: message.message
      });
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

function ledgerEntry(finding) {
  const entry = {
    file: finding.file,
    rule: finding.rule,
    fingerprint: finding.fingerprint,
    ordinal: finding.ordinal,
    snippet: finding.snippet
  };
  if (OWNERSHIP[finding.file]) {
    entry.owner = OWNERSHIP[finding.file];
  }
  return entry;
}

function readInventory() {
  if (!existsSync(inventoryPath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(inventoryPath, 'utf8'));
}

export function compare(inventory, findings) {
  const errors = [];

  if (!inventory || inventory.version !== INVENTORY_VERSION || !Array.isArray(inventory.sites)) {
    return {
      errors: [`Inventory is missing or not version ${INVENTORY_VERSION} with a \`sites\` array. Seed it with --write-inventory --seed and review the result.`]
    };
  }

  const expected = new Map(inventory.sites.map(entry => [siteKey(entry), entry]));
  const actual = new Map(findings.map(finding => [siteKey(finding), finding]));

  for (const [key, finding] of actual) {
    if (!expected.has(key)) {
      errors.push(
        `NEW hot-path antipattern site: ${finding.file}:${finding.line} [${finding.rule}]\n`
        + `      ${finding.snippet}\n`
        + `      ${finding.message}`
      );
    }
  }

  for (const [key, entry] of expected) {
    if (!actual.has(key)) {
      errors.push(`STALE inventory entry (site removed or rewritten): ${entry.file} [${entry.rule}] ${entry.fingerprint}\n`
        + `      ${entry.snippet}\n`
        + '      Prune it with `node scripts/verify-hot-path-antipatterns.mjs --write-inventory` in the same commit.');
    }
  }

  return { errors };
}

export function writeInventory(findings, { seed = false } = {}) {
  const prior = readInventory();
  const sites = findings.map(ledgerEntry);

  if (!seed) {
    if (!prior) {
      throw new Error('No inventory to refresh. Use --write-inventory --seed for the initial reviewed ledger.');
    }
    const expected = new Set(prior.sites.map(siteKey));
    const added = sites.filter(entry => !expected.has(siteKey(entry)));
    if (added.length > 0) {
      throw new Error(
        `--write-inventory is deletion-only. Refusing to add ${added.length} site(s):\n`
        + added.map(entry => `  ${entry.file} [${entry.rule}] ${entry.fingerprint}`).join('\n')
        + '\nFix the site, or make an explicit reviewed ledger edit.'
      );
    }
  }

  const inventory = { version: INVENTORY_VERSION, policy: POLICY, sites };
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

async function main() {
  const argv = process.argv.slice(2);
  const all = await collectFindings();
  const findings = all.filter(finding => !exceptionFor(finding));

  if (argv.includes('--report')) {
    for (const finding of all.filter(exceptionFor)) {
      console.log(`\nexception: ${finding.file}:${finding.line} [${finding.rule}] ${finding.snippet}\n      ${exceptionFor(finding).reason}`);
    }
    const byRule = new Map();
    for (const finding of findings) {
      if (!byRule.has(finding.rule)) {
        byRule.set(finding.rule, []);
      }
      byRule.get(finding.rule).push(finding);
    }
    for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n${rule} — ${list.length} site(s)`);
      for (const finding of list) {
        const owner = OWNERSHIP[finding.file] ? `  [owned: ${OWNERSHIP[finding.file]}]` : '';
        console.log(`  ${finding.file}:${finding.line}${owner}`);
        console.log(`      ${finding.snippet.slice(0, 120)}`);
      }
    }
    console.log(`\nNamed set: ${findings.length} site(s). This is a report; it never fails.`);
    return;
  }

  if (argv.includes('--write-inventory')) {
    const inventory = writeInventory(findings, { seed: argv.includes('--seed') });
    console.log(`Wrote hot-path antipattern inventory: ${inventory.sites.length} named sites.`);
    return;
  }

  const { errors } = compare(readInventory(), findings);

  if (errors.length === 0) {
    console.log(`Hot-path antipattern inventory is satisfied: ${findings.length} known site(s), 0 new, 0 stale.`);
    return;
  }

  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  if (errors.some(error => error.startsWith('NEW'))) {
    console.error(
      '\nThese are defects no byte-identity or correctness gate can see: they emit\n'
      + 'identical output while being quadratic, allocating per call, or re-deriving a\n'
      + 'fact the parser already owned. See docs/perf/HOT-PATH-ANTIPATTERN-GATE.md.'
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
