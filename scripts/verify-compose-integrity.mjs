#!/usr/bin/env node
/**
 * Compose-integrity gate.
 *
 * parseman's build-time `compose()` macro degrades SILENTLY: when a composed
 * grammar can't be build-resolved it emits a warning and falls back to the
 * runtime interpreter, and when a rule references a rule that isn't present it
 * throws `compose: rule "x" references missing rule "y"`. Either class recently
 * downgraded a parser to the interpreter without failing any test, because the
 * warning only appears in the build/compile output — not in assertions.
 *
 * This gate scans compose output for those signatures and FAILS if present.
 *
 * Two modes:
 *   --log <file>   Grep an already-captured build log (used by verify:pr / CI,
 *                  which capture the clean serial build once and reuse it).
 *   (no --log)     Rebuild the grammar-bearing parser packages from clean,
 *                  capturing combined stdout+stderr, then grep that output.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/*
 * Signatures that mean a grammar silently degraded to the runtime interpreter
 * or failed to compose. Kept in sync with parseman's macro plugin warnings.
 */
const DEGRADE_PATTERNS = [
  /compose\(\):[^\n]*falling back to runtime/i,
  /compose:\s*rule\s+"[^"]*"\s+references missing rule/i,
  /falling back to runtime/i
];

// parseman-macro parser packages, in topological (compose) order.
const PARSER_PACKAGES = [
  '@jesscss/parser-shared',
  '@jesscss/css-parser',
  '@jesscss/less-parser',
  '@jesscss/scss-parser',
  '@jesscss/jess-parser'
];

function scan(text, sourceLabel) {
  const hits = [];
  for (const line of text.split('\n')) {
    if (DEGRADE_PATTERNS.some(pattern => pattern.test(line))) {
      hits.push(line.trim());
    }
  }
  if (hits.length > 0) {
    console.error(`\nCompose-integrity FAILED (${sourceLabel}). A grammar silently degraded:`);
    for (const hit of hits) {
      console.error(`  ${hit}`);
    }
    console.error('\nFix the compose() macro so the grammar builds fully — do NOT ship a parser that fell back to the interpreter.');
    process.exit(1);
  }
}

const logFlagIndex = process.argv.indexOf('--log');

if (logFlagIndex !== -1) {
  const logPath = process.argv[logFlagIndex + 1];
  if (!logPath) {
    console.error('--log requires a file path');
    process.exit(2);
  }
  const resolved = path.resolve(ROOT, logPath);
  let text;
  try {
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    console.error(`Could not read build log at ${resolved}: ${error.message}`);
    process.exit(2);
  }
  scan(text, `build log ${path.relative(ROOT, resolved)}`);
  console.log('Compose-integrity OK (no grammar degraded to the interpreter).');
  process.exit(0);
}

// Standalone mode: rebuild the parser packages from clean and grep the output.
console.log('==> Compose-integrity: clean rebuild of grammar parsers');
let combined = '';
for (const pkg of PARSER_PACKAGES) {
  /*
   * Map npm name to its directory path under packages/. The grammar regroup
   * moved parsers + plugins into packages/syntax/<lang>/; capability plugins
   * and foundation packages stayed flat. This map is the source of truth.
   */
  const pkgDirRel = {
    '@jesscss/parser-shared': 'parser-shared',
    '@jesscss/css-parser': 'syntax/css/css-parser',
    '@jesscss/less-parser': 'syntax/less/less-parser',
    '@jesscss/scss-parser': 'syntax/scss/scss-parser',
    '@jesscss/jess-parser': 'syntax/jess/jess-parser'
  }[pkg];
  if (!pkgDirRel) {
    console.error(`No directory mapping for ${pkg}; update PARSER_PACKAGES.`);
    process.exit(1);
  }
  const libDir = path.join(ROOT, 'packages', pkgDirRel, 'lib');
  rmSync(libDir, { recursive: true, force: true });
  console.log(`\n$ pnpm --filter ${pkg} build`);
  const result = spawnSync('pnpm', ['--filter', pkg, 'build'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  combined += out;
  if (result.status !== 0) {
    console.error(`\nBuild failed for ${pkg} (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

scan(combined, 'clean parser rebuild');
console.log('\nCompose-integrity OK (no grammar degraded to the interpreter).');
