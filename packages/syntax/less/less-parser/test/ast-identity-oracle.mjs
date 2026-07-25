/**
 * AST/CST byte-identity oracle for `@jesscss/less-parser`.
 *
 * WHAT IT IS FOR
 * --------------
 * The acceptance gate for grammar refactors. A cleanup of `src/grammar.ts` or
 * `src/ast/grammar.ts` is only accepted if BOTH aggregate hashes below are
 * unchanged. A conversion that moves either aggregate is a FAILED conversion —
 * revert it, or (if the move is intended) it is a semantics change and needs an
 * owner decision, not a refactor commit.
 *
 * It exists because the obvious alternative does not work at the pinned parseman:
 * `analyzeGating()` throws for 129 of 129 rules of the `compose()`d Less CST, and
 * the AST grammar is unreachable behind `composeLeaf`. See
 * `docs/architecture/parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` §2.
 *
 * HOW TO RUN
 * ----------
 *   pnpm --filter @jesscss/less-parser build      # REQUIRED, see below
 *   node packages/less-parser/test/ast-identity-oracle.mjs [out.json]
 *
 * Typical loop:
 *   1. build + run, save as `before.json`, note the two aggregates
 *   2. edit the grammar
 *   3. build + run, save as `after.json`
 *   4. aggregates equal -> the conversion is AST-neutral; unequal -> diff the
 *      `perFile` maps to find which files moved
 *
 * WHY IT PARSES THE BUILT `lib/`, NOT `src/`
 * ------------------------------------------
 * `lib/` is the macro-COMPILED artifact, which is what ships — and a macro-FALLBACK
 * build emits a DIFFERENT tree than the compiled one (VERIFIED-CONSTRAINTS §1). So
 * you must rebuild between edits, and you must keep `node scripts/check-macro-buildable.mjs`
 * green: a red macro-buildability check INVALIDATES any hash taken on that build.
 * (`src/` is also simply not loadable standalone — see the doc.)
 *
 * WHAT IS HASHED
 * --------------
 * Both shipping surfaces, independently:
 *   - `aggAst` — `parse()`, the AST v2 route used by `src/index.ts`. THE shipping path.
 *   - `aggCst` — `parseLessCst()`, the CST route consumed by the language service.
 * A refactor touching only one grammar should move neither; the untouched surface
 * doubles as a control.
 *
 * Parse FAILURES are hashed too (`ERR:<name>:<message>`), so error behaviour is part
 * of the differential — a change that turns a hard error into a silent accept is
 * caught. `astThrew` is expected to be non-zero: the corpus deliberately includes
 * `tests-error/**` and plain CSS that Less rejects. What matters is that the count
 * and the hashes do not move.
 *
 * The projection is key-sorted and cycle-safe so hashes are stable across runs and
 * insensitive to property insertion order.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../lib/index.js';
import { parseLessCst } from '../lib/cst.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * Corpus roots. Every `.less` and `.css` under each is used. A missing root is
 * skipped silently (the bootstrap port is an optional transitive dep), so check the
 * reported `files=` count against the value in the commit you are comparing to —
 * a differential over a SMALLER corpus is not the same gate.
 */
const ROOTS = [
  'node_modules/@less/test-data/tests-unit',
  'node_modules/@less/test-data/tests-config',
  'node_modules/@less/test-data/tests-error',
  'node_modules/@less/test-data/data',
  'node_modules/.pnpm/bootstrap-less-port@2.5.1_less@3.13.1/node_modules/bootstrap-less-port/less',
  'packages/jess/test',
  'packages/syntax/less/less-parser/test',
  'packages/syntax/css/css-parser/test'
];

function listFiles() {
  const out = new Set();
  for (const root of ROOTS) {
    try {
      const listing = execFileSync(
        'find',
        ['-L', resolve(repo, root), '-type', 'f', '(', '-name', '*.less', '-o', '-name', '*.css', ')'],
        { encoding: 'utf8', maxBuffer: 1 << 28 }
      );
      for (const line of listing.split('\n')) {
        if (line) {
          out.add(line);
        }
      }
    } catch {
      // Root absent in this install — skipped, and reflected in the `files=` count.
    }
  }
  return [...out].sort();
}

/** Key-sorted, cycle-safe JSON projection — stable across runs. */
function project(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function') {
        return '[fn]';
      }
      return typeof v === 'bigint' ? String(v) : v;
    }
    if (seen.has(v)) {
      return '[cycle]';
    }
    seen.add(v);
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    const o = {};
    for (const k of Object.keys(v).sort()) {
      o[k] = walk(v[k]);
    }
    return o;
  };
  return JSON.stringify(walk(value));
}

/**
 * The `OK:` / `ERR:` prefix is part of the hashed payload and must NOT be dropped:
 * it keeps a successful parse and a thrown error in distinct hash spaces, and the
 * aggregates quoted in landed commit messages were computed with it. Changing the
 * payload shape silently invalidates every recorded baseline.
 */
function hashParse(fn) {
  try {
    return { hash: `OK:${project(fn())}`, threw: false };
  } catch (e) {
    return { hash: `ERR:${e.name}:${e.message}`, threw: true };
  }
}

const perFile = {};
let astThrew = 0;
let cstThrew = 0;
for (const file of listFiles()) {
  if (statSync(file).size > 2_000_000) {
    continue;
  }
  const src = readFileSync(file, 'utf8');
  const ast = hashParse(() => parse(src));
  const cst = hashParse(() => parseLessCst(src));
  if (ast.threw) {
    astThrew++;
  }
  if (cst.threw) {
    cstThrew++;
  }
  perFile[file.slice(repo.length + 1)] = {
    ast: createHash('sha256').update(ast.hash).digest('hex').slice(0, 16),
    cst: createHash('sha256').update(cst.hash).digest('hex').slice(0, 16)
  };
}

const names = Object.keys(perFile).sort();
const aggregate = surface =>
  createHash('sha256').update(names.map(n => `${n}:${perFile[n][surface]}`).join('\n')).digest('hex');

const aggAst = aggregate('ast');
const aggCst = aggregate('cst');

if (process.argv[2]) {
  writeFileSync(process.argv[2], JSON.stringify({ files: names.length, astThrew, cstThrew, aggAst, aggCst, perFile }));
}
console.log(`files=${names.length} astThrew=${astThrew} cstThrew=${cstThrew}`);
console.log(`aggAst=${aggAst}`);
console.log(`aggCst=${aggCst}`);
