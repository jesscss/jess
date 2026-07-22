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
 * `--write-inventory` is deletion-only. There is deliberately no refresh or
 * migration escape hatch: adding a site requires an explicit, reviewed exact
 * ledger edit, and the normal verifier rejects it until that edit lands.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

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
// These methods answer a recognition question directly. Deliberately do not ban
// generic copying methods such as `.slice()`: on a node/child collection those
// are not source recognition, and TypeScript syntax alone cannot prove the type.
const sourceStringMethods = new Set(['indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith']);
const reparseLikeName = /^parse(?:Css|Less|Scss|Jess)Fn(?:[A-Z][A-Za-z0-9_]*)?$/;

function sourceFiles(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...sourceFiles(path));
      continue;
    }
    if (
      sourceExtensions.has(extname(entry.name))
      && !entry.name.endsWith('.d.ts')
    ) {
      paths.push(path);
    }
  }
  return paths;
}

function parsemanRegexBindings(source) {
  const bindings = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'parseman') {
      continue;
    }
    const isMacroImport = statement.attributes?.elements.some((attribute) => {
      const key = attribute.name.kind === ts.SyntaxKind.Identifier
        ? attribute.name.text
        : String(attribute.name.text);
      return key === 'type' && attribute.value.text === 'macro';
    }) ?? false;
    if (!isMacroImport) {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) {
      continue;
    }
    for (const specifier of named.elements) {
      if ((specifier.propertyName?.text ?? specifier.name.text) === 'regex') {
        bindings.add(specifier.name.text);
      }
    }
  }
  return bindings;
}

function bindingPatternHasName(name, pattern) {
  if (ts.isIdentifier(pattern)) {
    return pattern.text === name;
  }
  if (ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern)) {
    return pattern.elements.some(element => ts.isBindingElement(element) && bindingPatternHasName(name, element.name));
  }
  return false;
}

function scopeShadowsName(node, name) {
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionLike(current) && current.parameters.some(parameter => bindingPatternHasName(name, parameter.name))) {
      return true;
    }
    if (ts.isBlock(current) || ts.isModuleBlock(current)) {
      for (const statement of current.statements) {
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => bindingPatternHasName(name, declaration.name))) {
          return true;
        }
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
          return true;
        }
      }
    }
  }
  return false;
}

function isGrammarRegex(node, file, regexBindings) {
  const parent = node.parent;
  // Parseman `regex(...)` is declarative grammar input and macro-compiles into
  // the parser artifact. Recognition-only source modules may intentionally be
  // named something other than a bare `grammar.ts`; the imported macro binding,
  // rather than the filename, is the actual runtime-boundary proof.
  return ts.isCallExpression(parent)
    && parent.arguments.includes(node)
    && ts.isIdentifier(parent.expression)
    && regexBindings.has(parent.expression.text)
    && !scopeShadowsName(parent, parent.expression.text);
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

const shadow = 'shadow';
const object = 'object';

/** A deliberately small lexical environment.  We need scope here because a
 * parser-shaped local name must not taint an unrelated function, loop, or
 * catch binding elsewhere in the same file. */
function makeScope(parent = undefined) {
  return { parent, bindings: new Map(), properties: new Map() };
}

function resolveBinding(scope, name) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) {
      return current.bindings.get(name);
    }
  }
  return undefined;
}

function bind(scope, name, kind = shadow, properties = undefined) {
  scope.bindings.set(name, kind);
  if (properties) {
    scope.properties.set(name, properties);
  }
}

function assign(scope, name, kind, properties = undefined) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) {
      bind(current, name, kind, properties);
      return;
    }
  }
  bind(scope, name, kind, properties);
}

function objectProperties(expression, scope) {
  if (!ts.isObjectLiteralExpression(expression)) {
    return undefined;
  }
  const properties = new Map();
  for (const member of expression.properties) {
    if (!ts.isPropertyAssignment(member) || !member.name) {
      continue;
    }
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : undefined;
    if (name) {
      properties.set(name, expressionKind(member.initializer, scope));
    }
  }
  return properties;
}

function typeContainsString(type) {
  if (!type) {
    return false;
  }
  if (type.kind === ts.SyntaxKind.StringKeyword || (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal))) {
    return true;
  }
  return ts.isUnionTypeNode(type) && type.types.some(typeContainsString);
}

function typeProperties(type) {
  if (!type) {
    return undefined;
  }
  if (ts.isTypeLiteralNode(type)) {
    const properties = new Map();
    for (const member of type.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        continue;
      }
      const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : undefined;
      if (name && typeContainsString(member.type)) {
        properties.set(name, 'text');
      }
    }
    return properties.size > 0 ? properties : undefined;
  }
  // Parser CST leaf aliases are the one source object shape whose `.value` is
  // semantically source text. Do not infer that for arbitrary `.value` fields.
  if (ts.isTypeReferenceNode(type) && /(?:^|\.)(?:CSTLeaf|CSTLike|CSTChild|CSTRawChild)$/.test(type.typeName.getText())) {
    return new Map([['value', 'text']]);
  }
  return undefined;
}

function objectPropertiesOf(expression, scope) {
  const literal = objectProperties(expression, scope);
  if (literal) {
    return literal;
  }
  if (!ts.isIdentifier(expression) || resolveBinding(scope, expression.text) !== object) {
    return undefined;
  }
  for (let current = scope; current; current = current.parent) {
    const properties = current.properties.get(expression.text);
    if (properties) {
      return properties;
    }
  }
  return undefined;
}

function objectMemberKind(receiver, property, scope) {
  if (!ts.isIdentifier(receiver) || resolveBinding(scope, receiver.text) !== object) {
    return undefined;
  }
  for (let current = scope; current; current = current.parent) {
    const properties = current.properties.get(receiver.text);
    if (properties?.has(property)) {
      return properties.get(property);
    }
  }
  return undefined;
}

function propertyKind(expression, scope) {
  const property = propertyName(expression);
  if (!property) {
    return undefined;
  }
  const receiver = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
    ? expression.expression
    : undefined;
  // A known object member beats the loose name heuristic. `payload.value`
  // may be a child collection, not source text, and that fact must survive
  // member access and later destructuring.
  const memberKind = receiver ? objectMemberKind(receiver, property, scope) : undefined;
  if (memberKind !== undefined) {
    return memberKind;
  }
  if (property === 'RegExp') {
    return 'regexp';
  }
  if (reparseLikeName.test(property)) {
    return 'parser';
  }
  if (recognizerMethods.has(property)) {
    return property;
  }
  if (sourceStringMethods.has(property) && receiver && isTextLike(receiver, scope)) {
    return `string-method:${property}`;
  }
  return undefined;
}

function expressionKind(expression, scope) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return 'text';
  }
  if (ts.isIdentifier(expression)) {
    return resolveBinding(scope, expression.text);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return object;
  }
  if (ts.isPropertyAccessExpression(expression) && propertyName(expression) === 'bind') {
    return expressionKind(expression.expression, scope);
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && propertyName(expression.expression) === 'bind') {
    return expressionKind(expression.expression.expression, scope);
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return propertyKind(expression, scope);
  }
  return undefined;
}

function isTextLike(expression, scope) {
  return expressionKind(expression, scope) === 'text';
}

function bindPattern(pattern, initializer, scope, type) {
  if (ts.isIdentifier(pattern)) {
    const typedProperties = typeProperties(type);
    const typedKind = typeContainsString(type) ? 'text' : typedProperties ? object : shadow;
    const kind = initializer
      ? (expressionKind(initializer, scope) ?? (isTextLike(initializer, scope) ? 'text' : typedKind))
      : typedKind;
    bind(scope, pattern.text, kind, kind === object ? (objectPropertiesOf(initializer, scope) ?? typedProperties) : undefined);
    return;
  }
  if (!ts.isObjectBindingPattern(pattern)) {
    return;
  }
  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
      continue;
    }
    const property = element.propertyName?.getText() ?? element.name.text;
    const memberKind = initializer ? objectMemberKind(initializer, property, scope) : undefined;
    const kind = memberKind ?? (reparseLikeName.test(property)
      ? 'parser'
      : property === 'RegExp'
        ? 'regexp'
        : recognizerMethods.has(property)
          ? property
          : sourceStringMethods.has(property) && initializer && isTextLike(initializer, scope)
            ? `string-method:${property}`
            : shadow);
    bind(scope, element.name.text, kind);
  }
}

/** Scan one parser-source file. Exported for the regression tests. */
export function scanParserSource(file, text, source = undefined) {
  const findings = [];
  source ??= ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const regexBindings = parsemanRegexBindings(source);
  const rootScope = makeScope();
  for (const name of ['parseLessFn', 'parseScssFn', 'parseJessFn']) {
    bind(rootScope, name, 'parser');
  }
  bind(rootScope, 'RegExp', 'regexp');
  const add = (node, kind) => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const snippet = node.getText(source).replace(/\s+/g, ' ').slice(0, 160);
    findings.push({
      file: relative(root, file).replaceAll('\\', '/'),
      line: start.line + 1,
      column: start.character + 1,
      start: node.getStart(source),
      end: node.getEnd(),
      kind,
      fingerprint: fingerprint(`${kind}:${snippet}`),
      snippet
    });
  };
  const scanExpression = (node, scope) => {
    if (ts.isRegularExpressionLiteral(node) && !isGrammarRegex(node, file, regexBindings)) {
      add(node, 'regex-literal');
    }
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node))
      && propertyName(node.expression) !== 'bind'
      && expressionKind(node.expression, scope) === 'regexp'
    ) {
      add(node, 'regexp-constructor');
    }
    if (ts.isElementAccessExpression(node) && isTextLike(node.expression, scope)) {
      add(node, 'runtime-string-index');
    }
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined;
      if (method && recognizerMethods.has(method)) {
        add(node, `runtime-${method}`);
      }
      if (method && sourceStringMethods.has(method) && receiver && isTextLike(receiver, scope)) {
        add(node, `runtime-${method}`);
      }
      if (ts.isIdentifier(node.expression) && recognizerMethods.has(expressionKind(node.expression, scope))) {
        add(node, `runtime-${expressionKind(node.expression, scope)}`);
      }
      if (ts.isIdentifier(node.expression) && String(expressionKind(node.expression, scope)).startsWith('string-method:')) {
        add(node, `runtime-${String(expressionKind(node.expression, scope)).slice('string-method:'.length)}`);
      }
      if (method === 'call' && ts.isPropertyAccessExpression(node.expression)) {
        const aliasedMethod = expressionKind(node.expression.expression, scope);
        if (aliasedMethod && recognizerMethods.has(aliasedMethod)) {
          add(node, `runtime-${aliasedMethod}`);
        }
      }
      if (expressionKind(node.expression, scope) === 'parser') {
        add(node, 'reparse-entrypoint');
      }
    }
    ts.forEachChild(node, child => scanNode(child, scope));
  };

  const scanStatements = (statements, scope) => {
    for (const statement of statements) {
      scanNode(statement, scope);
    }
  };
  const scanNode = (node, scope) => {
    if (ts.isSourceFile(node)) {
      scanStatements(node.statements, scope);
      return;
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      scanStatements(node.statements, makeScope(scope));
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) {
        scanExpression(node.initializer, scope);
      }
      bindPattern(node.name, node.initializer, scope, node.type);
      return;
    }
    if (ts.isFunctionLike(node)) {
      const functionScope = makeScope(scope);
      for (const parameter of node.parameters) {
        bindPattern(parameter.name, undefined, functionScope, parameter.type);
      }
      if (node.body) {
        scanNode(node.body, functionScope);
      }
      return;
    }
    if (ts.isCatchClause(node)) {
      const catchScope = makeScope(scope);
      if (node.variableDeclaration) {
        bindPattern(node.variableDeclaration.name, undefined, catchScope);
      }
      scanNode(node.block, catchScope);
      return;
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const loopScope = makeScope(scope);
      ts.forEachChild(node, child => scanNode(child, loopScope));
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      scanExpression(node.right, scope);
      const kind = expressionKind(node.right, scope) ?? (isTextLike(node.right, scope) ? 'text' : shadow);
      if (ts.isIdentifier(node.left)) {
        assign(scope, node.left.text, kind, kind === object ? objectPropertiesOf(node.right, scope) : undefined);
      }
      if ((ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) && ts.isIdentifier(node.left.expression)) {
        const property = propertyName(node.left);
        if (property) {
          for (let current = scope; current; current = current.parent) {
            const properties = current.properties.get(node.left.expression.text);
            if (properties) {
              properties.set(property, kind);
            }
          }
        }
      }
      return;
    }
    scanExpression(node, scope);
  };
  scanNode(source, rootScope);
  return findings;
}

export function scanParserSources({ base = root } = {}) {
  return parserRoots.flatMap(sourceRoot => sourceFiles(resolve(base, sourceRoot)).flatMap(file =>
    scanParserSource(file, readFileSync(file, 'utf8'))
  ));
}

function ledgerEntries(findings, priorDebt = []) {
  const prior = new Map(priorDebt.map(entry => [inventoryKey(entry), entry]));
  return findings.map((finding) => {
    const priorEntry = prior.get(inventoryKey(finding));
    return {
      file: finding.file,
      line: finding.line,
      column: finding.column,
      start: finding.start,
      end: finding.end,
      kind: finding.kind,
      fingerprint: finding.fingerprint,
      snippet: finding.snippet,
      retirement: priorEntry?.retirement ?? 'Delete by moving this recognition into Parseman grammar during the AST v2 parser cutover.'
    };
  }).sort((a, b) =>
    a.file.localeCompare(b.file) || a.start - b.start || a.kind.localeCompare(b.kind)
  );
}

function readInventory() {
  return JSON.parse(readFileSync(inventoryPath, 'utf8'));
}

function stagedFile(path) {
  return execFileSync('git', ['show', `:${path}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** Validate the index without reading a conflicting worktree file. */
function validateStagedSnapshot() {
  const snapshot = mkdtempSync(resolve(tmpdir(), 'jess-parser-boundary-'));
  try {
    for (const sourceRoot of parserRoots) {
      for (const file of sourceFiles(resolve(root, sourceRoot))) {
        const relativePath = relative(root, file);
        const target = resolve(snapshot, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, stagedFile(relativePath));
      }
    }
    const inventory = JSON.parse(stagedFile('scripts/parser-runtime-boundary-debt.json'));
    const findings = scanParserSources({ base: snapshot });
    return validateInventory(inventory, findings, { base: snapshot });
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

function inventoryKey(entry) {
  return `${entry.file}\u0000${entry.kind}\u0000${entry.start}\u0000${entry.end}\u0000${entry.fingerprint}`;
}

/**
 * Some legacy CST sites still lack enough imported type information for the
 * lightweight provenance walk. They are not exemptions: keep an exact raw
 * source proof until the detector learns that CST shape or the site is deleted.
 */
export function validateUntracedSource(entry, { base = root } = {}) {
  const file = resolve(base, entry.file);
  if (!file.startsWith(`${base}/`) || !existsSync(file)) {
    return `Untraced debt source is missing: ${entry.file}:${entry.kind}:${entry.fingerprint}.`;
  }
  const text = readFileSync(file, 'utf8');
  if (
    !Number.isInteger(entry.start)
    || !Number.isInteger(entry.end)
    || entry.start < 0
    || entry.end <= entry.start
    || entry.end > text.length
  ) {
    return `Untraced debt source span is invalid: ${entry.file}:${entry.kind}:${entry.fingerprint}.`;
  }
  const source = text.slice(entry.start, entry.end);
  const snippet = source.replace(/\s+/g, ' ').slice(0, 160);
  if (!snippet) {
    return `Untraced debt source snippet is empty: ${entry.file}:${entry.kind}:${entry.fingerprint}.`;
  }
  if (snippet !== entry.snippet || fingerprint(`${entry.kind}:${snippet}`) !== entry.fingerprint) {
    return `Untraced debt source changed: ${entry.file}:${entry.kind}:${entry.fingerprint}.`;
  }
  return undefined;
}

export function validateInventory(inventory, findings, { base = root } = {}) {
  const errors = [];
  if (inventory.version !== 2 || !Array.isArray(inventory.debt)) {
    return ['Parser runtime-boundary inventory must be version 2 with an exact-site debt array.'];
  }
  const actual = new Map(ledgerEntries(findings).map(entry => [inventoryKey(entry), entry]));
  const expected = new Map(inventory.debt.map(entry => [inventoryKey(entry), entry]));
  for (const [key, entry] of expected) {
    if (
      !Number.isInteger(entry.start)
      || !Number.isInteger(entry.end)
      || entry.start < 0
      || entry.end < entry.start
      || typeof entry.snippet !== 'string'
      || typeof entry.retirement !== 'string'
      || entry.retirement.trim().length < 16
    ) {
      errors.push(`Invalid debt entry: ${entry.file} ${entry.kind} ${entry.fingerprint}.`);
      continue;
    }
    const found = actual.get(key);
    if (!found) {
      if (entry.untraced === true) {
        const proofError = validateUntracedSource(entry, { base });
        if (!proofError) {
          continue;
        }
        errors.push(proofError);
        continue;
      }
      errors.push(`Debt inventory is stale (site was removed or changed): ${entry.file}:${entry.kind}:${entry.fingerprint}. Remove the ledger entry.`);
    }
  }
  for (const [key, entry] of actual) {
    if (!expected.has(key)) {
      errors.push(`New handwritten parser recognizer: ${entry.file}:${entry.kind}:${entry.fingerprint}. Move it into Parseman grammar; do not add a debt exception.`);
    }
  }
  return errors;
}

export function validateInventoryShrink(priorDebt, nextDebt) {
  const prior = new Map(priorDebt.map(entry => [inventoryKey(entry), entry]));
  const errors = [];
  for (const entry of nextDebt) {
    if (!prior.has(inventoryKey(entry))) {
      errors.push(`Refusing new, substituted, or moved parser debt: ${entry.file}:${entry.kind}:${entry.start}-${entry.end}.`);
    }
  }
  return errors;
}

export function writeInventory(findings, { path = inventoryPath, base = root } = {}) {
  if (!existsSync(path)) {
    throw new Error('Parser runtime debt inventory is missing; create an explicit reviewed exact-site ledger before enabling this verifier.');
  }
  const priorInventory = JSON.parse(readFileSync(path, 'utf8'));
  if (priorInventory.version !== 2) {
    throw new Error('Parser runtime debt inventory must be version 2; update the exact reviewed ledger directly.');
  }
  const prior = priorInventory.debt;
  const proofErrors = prior
    .filter(entry => entry.untraced === true)
    .map(entry => validateUntracedSource(entry, { base }))
    .filter(Boolean);
  if (proofErrors.length) {
    throw new Error(proofErrors.join('\n'));
  }
  const debt = ledgerEntries(findings, prior);
  for (const entry of prior) {
    if (entry.untraced === true && !debt.some(candidate => inventoryKey(candidate) === inventoryKey(entry))) {
      debt.push(entry);
    }
  }
  debt.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start || a.kind.localeCompare(b.kind));
  const errors = validateInventoryShrink(prior, debt);
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  const inventory = {
    version: 2,
    policy: 'Every handwritten runtime recognizer is temporary debt. The final gate has debt: [].',
    debt
  };
  writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

function main() {
  if (process.argv.includes('--staged')) {
    if (process.argv.includes('--write-inventory')) {
      throw new Error('--write-inventory cannot target the staged snapshot.');
    }
    const errors = validateStagedSnapshot();
    if (errors.length > 0) {
      console.error('Parser runtime boundary failed for staged snapshot:\n' + errors.map(error => `- ${error}`).join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('Parser runtime boundary: staged snapshot is clean.');
    return;
  }
  const findings = scanParserSources();
  if (process.argv.includes('--write-inventory')) {
    const inventory = writeInventory(findings);
    console.log(`Wrote parser runtime debt inventory: ${inventory.debt.length} exact sites.`);
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
  console.log(`Parser runtime boundary: ${findings.length} tracked temporary sites (${inventory.debt.length} exact ledger sites); final gate requires 0.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
