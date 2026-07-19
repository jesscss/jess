#!/usr/bin/env node
/**
 * Enforces the parser runtime boundary.
 *
 * The four dialect packages may describe recognition with Parseman grammar
 * combinators.  They may not recognize source again in handwritten runtime
 * code.  The inventory is deliberately exact and shrinking: it records every
 * currently-known legacy site, not a file-level exemption.  A new site fails
 * this command, even when it is added to a file which already has debt.
 *
 * `--write-inventory` is only for deleting debt or creating the initial
 * inventory.  It refuses to grow an existing inventory; adding an exception
 * therefore requires an intentional reviewed edit to the ledger.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// The workspace pins the compiler API package separately from the experimental
// `typescript` package, whose package export intentionally has no CommonJS main.
const ts = require('@typescript/typescript6/lib/typescript.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = resolve(root, 'scripts/parser-runtime-boundary-debt.json');
const parserRoots = [
  'packages/css-parser/src',
  'packages/less-parser/src',
  'packages/scss-parser/src',
  'packages/jess-parser/src'
];
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const recognizerMethods = new Set(['charCodeAt', 'charAt', 'codePointAt', 'exec', 'test', 'match', 'search']);
const reparseEntrypoints = /^(?:parseCssFn|parseLessFn|parseScssFn|parseJessFn)$/;

function sourceFiles(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'generated' && entry.name !== 'dist') {
        paths.push(...sourceFiles(path));
      }
      continue;
    }
    if (
      sourceExtensions.has(extname(entry.name))
      && !entry.name.endsWith('.d.ts')
      && !entry.name.includes('.test.')
      && !entry.name.includes('.spec.')
    ) {
      paths.push(path);
    }
  }
  return paths;
}

function isGrammarRegex(node, file) {
  const parent = node.parent;
  return relative(root, file).endsWith('/grammar.ts')
    && ts.isCallExpression(parent)
    && parent.arguments.includes(node)
    && ts.isIdentifier(parent.expression)
    && parent.expression.text === 'regex';
}

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Scan one parser-source file. Exported for the regression tests. */
export function scanParserSource(file, text) {
  const findings = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const add = (node, kind) => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const snippet = node.getText(source).replace(/\s+/g, ' ').slice(0, 160);
    findings.push({
      file: relative(root, file).replaceAll('\\', '/'),
      line: start.line + 1,
      column: start.character + 1,
      kind,
      fingerprint: fingerprint(`${kind}:${snippet}`),
      snippet
    });
  };
  const visit = (node) => {
    if (ts.isRegularExpressionLiteral(node) && !isGrammarRegex(node, file)) {
      add(node, 'regex-literal');
    }
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node))
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'RegExp'
    ) {
      add(node, 'regexp-constructor');
    }
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      if (method && recognizerMethods.has(method)) {
        add(node, `runtime-${method}`);
      }
      if (
        ts.isIdentifier(node.expression)
        && reparseEntrypoints.test(node.expression.text)
      ) {
        add(node, 'reparse-entrypoint');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export function scanParserSources({ base = root } = {}) {
  return parserRoots.flatMap(sourceRoot => sourceFiles(resolve(base, sourceRoot)).flatMap(file =>
    scanParserSource(file, readFileSync(file, 'utf8'))
  ));
}

function ledgerEntries(findings, priorDebt = []) {
  const prior = new Map(priorDebt.map(entry => [inventoryKey(entry), entry]));
  const grouped = new Map();
  for (const finding of findings) {
    const key = `${finding.file}\u0000${finding.kind}\u0000${finding.fingerprint}`;
    const priorEntry = prior.get(key);
    const group = grouped.get(key) ?? {
      file: finding.file,
      kind: finding.kind,
      fingerprint: finding.fingerprint,
      count: 0,
      retirement: priorEntry?.retirement ?? 'Delete by moving this recognition into Parseman grammar during the AST v2 parser cutover.'
    };
    group.count += 1;
    grouped.set(key, group);
  }
  return [...grouped.values()].sort((a, b) =>
    a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.fingerprint.localeCompare(b.fingerprint)
  );
}

function readInventory() {
  return JSON.parse(readFileSync(inventoryPath, 'utf8'));
}

function inventoryKey(entry) {
  return `${entry.file}\u0000${entry.kind}\u0000${entry.fingerprint}`;
}

export function validateInventory(inventory, findings) {
  const errors = [];
  if (inventory.version !== 1 || !Array.isArray(inventory.debt)) {
    return ['Parser runtime-boundary inventory must be version 1 with a debt array.'];
  }
  const actual = new Map(ledgerEntries(findings).map(entry => [inventoryKey(entry), entry]));
  const expected = new Map(inventory.debt.map(entry => [inventoryKey(entry), entry]));
  for (const [key, entry] of expected) {
    if (!Number.isInteger(entry.count) || entry.count < 1 || typeof entry.retirement !== 'string' || entry.retirement.trim().length < 16) {
      errors.push(`Invalid debt entry: ${entry.file} ${entry.kind} ${entry.fingerprint}.`);
      continue;
    }
    const found = actual.get(key);
    if (!found) {
      errors.push(`Debt inventory is stale (site was removed or changed): ${entry.file}:${entry.kind}:${entry.fingerprint}. Remove the ledger entry.`);
    } else if (found.count !== entry.count) {
      errors.push(`Debt count changed for ${entry.file}:${entry.kind}:${entry.fingerprint}: inventory ${entry.count}, source ${found.count}.`);
    }
  }
  for (const [key, entry] of actual) {
    if (!expected.has(key)) {
      errors.push(`New handwritten parser recognizer: ${entry.file}:${entry.kind}:${entry.fingerprint}. Move it into Parseman grammar; do not add a debt exception.`);
    }
  }
  return errors;
}

function writeInventory(findings) {
  const hasPrior = existsSync(inventoryPath);
  const prior = hasPrior ? readInventory().debt : [];
  const debt = ledgerEntries(findings, prior);
  if (hasPrior) {
    const priorCount = prior.reduce((sum, entry) => sum + entry.count, 0);
    const nextCount = debt.reduce((sum, entry) => sum + entry.count, 0);
    if (nextCount > priorCount) {
      throw new Error(`Refusing to grow parser runtime debt (${priorCount} -> ${nextCount}). New recognition must be grammar, not inventory.`);
    }
  }
  const inventory = {
    version: 1,
    policy: 'Every handwritten runtime recognizer is temporary debt. The final gate has debt: [].',
    debt
  };
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

function main() {
  const findings = scanParserSources();
  if (process.argv.includes('--write-inventory')) {
    const inventory = writeInventory(findings);
    console.log(`Wrote parser runtime debt inventory: ${inventory.debt.length} fingerprints / ${findings.length} sites.`);
    return;
  }
  const inventory = readInventory();
  const errors = validateInventory(inventory, findings);
  if (process.argv.includes('--require-clean') && inventory.debt.length > 0) {
    errors.push(`Parser runtime boundary is not clean: ${findings.length} temporary handwritten sites remain.`);
  }
  if (errors.length) {
    console.error('Parser runtime boundary failed:\n' + errors.map(error => `- ${error}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--report')) {
    for (const finding of findings) {
      console.log(`${finding.file}:${finding.line}:${finding.column} ${finding.kind} ${finding.snippet}`);
    }
  }
  console.log(`Parser runtime boundary: ${findings.length} tracked temporary sites (${inventory.debt.length} fingerprints); final gate requires 0.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
