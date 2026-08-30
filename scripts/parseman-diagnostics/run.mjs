#!/usr/bin/env node
/**
 * Run every applicable parseman 0.43 analysis surface against all four jess
 * dialect grammars, PER RULE.
 *
 * What is fed to what, and why:
 *
 *  - `analyzeGatingRules` / `analyzeDuplicationRules` take a `rules()` map of
 *    live `Combinator` objects. The shipping grammars are macro-compiled, so
 *    their rules are plain functions with no `_def` graph and the analysis is
 *    blind. The loader therefore builds the INTERPRETED artifact (no macro
 *    plugin, `composeLeaf` shimmed to runtime `compose`) and this script reads
 *    the raw pre-compose pieces off it.
 *  - `analyzeGrammarGating` is additionally run on the composed result, to
 *    record whether the compose boundary preserves or loses the verdict.
 *  - Coverage (`composedGrammarCoverageDefinitions` /
 *    `compiledGrammarCoverageDefinitions`) is attempted on both the interpreted
 *    compose result and the real macro artifact; every outcome, including the
 *    throws, is recorded rather than swallowed.
 *
 * Output: JSON on stdout (`--json`) or a per-rule text report (default).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeGatingRules,
  analyzeGrammarGating,
  analyzeDuplicationRules,
  formatGatingWarnings,
  formatDuplicationFindings,
  duplicationFindingCount,
  composedGrammarCoverageDefinitions,
  compiledGrammarCoverageDefinitions,
  grammarCoverageDefinitions
} from 'parseman';
import { loadInterpreted, loadMacro, GRAMMARS, ROOT } from './_load.mjs';

const COMPOSE_PIECES_RAW = Symbol.for('jess.diagnostics.composePiecesRaw');

/** A `rules()` map is a plain record whose values carry `_def`/`tag`. */
function combinatorEntries(piece) {
  if (!piece || typeof piece !== 'object') {
    return [];
  }
  return Object.entries(piece).filter(([, v]) => v && typeof v === 'object' && ('tag' in v || '_def' in v));
}

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

/** Silence compose()'s own console diagnostic while we drive it deliberately. */
function quietly(fn) {
  const warn = console.warn;
  const log = console.log;
  const captured = [];
  console.warn = (...args) => captured.push(args.join(' '));
  console.log = (...args) => captured.push(args.join(' '));
  try {
    return { value: fn(), captured };
  } finally {
    console.warn = warn;
    console.log = log;
  }
}

const report = { parseman: null, grammars: [] };

{
  const pkg = await import('parseman/package.json', { with: { type: 'json' } }).catch(() => null);
  report.parseman = {
    version: pkg?.default?.version ?? 'unknown',
    resolved: import.meta.resolve('parseman')
  };
}

const interpreted = await loadInterpreted();
const macro = await loadMacro();

try {
  for (const g of GRAMMARS) {
    const iMod = await interpreted.load(g.file);
    const mMod = await macro.load(g.file);

    for (const [surface, exportName] of Object.entries(g.exports)) {
      const composed = iMod[exportName];
      const compiled = mMod[exportName];
      const pieces = composed?.[COMPOSE_PIECES_RAW] ?? [];

      const entry = {
        dialect: g.dialect,
        surface,
        exportName,
        file: g.file,
        pieces: [],
        gatingPreCompose: null,
        gatingComposed: null,
        duplicationPreCompose: null,
        coverage: {}
      };

      /* --- per-piece census (which layer owns which rule) --- */
      const allEntries = [];
      pieces.forEach((piece, index) => {
        const es = combinatorEntries(piece);
        entry.pieces.push({ index, ruleCount: es.length, rules: es.map(([k]) => k) });
        allEntries.push(...es);
      });

      /* --- gating, fed the PRE-COMPOSE map (the supported input) --- */
      const gate = quietly(() => attempt(() => analyzeGatingRules(allEntries)));
      if (gate.value.ok) {
        const r = gate.value.value;
        entry.gatingPreCompose = {
          totalChoices: r.totalChoices,
          gated: r.gated,
          recoverable: r.recoverable,
          ungatedCount: r.ungated.length,
          deferredCount: r.deferred.length,
          acceptedCount: r.accepted.length,
          unanalysable: r.unanalysable.map(u => ({ rule: u.rule, kind: u.kind, reason: u.reason })),
          antiPatterns: r.antiPatterns,
          ungated: r.ungated.map(c => ({
            id: c.id,
            rule: c.rule ?? null,
            arms: c.arms,
            deferred: c.deferred,
            strategy: c.strategy,
            anyArms: (c.anyArms ?? []).map(a => ({ index: a.index, cause: a.cause, detail: a.detail ?? null })),
            overlaps: (c.overlaps ?? []).length
          })),
          warnings: formatGatingWarnings(r)
        };
      } else {
        entry.gatingPreCompose = { threw: gate.value.error };
      }

      /* --- gating, fed the COMPOSED artifact (the compose-boundary question) --- */
      const gateComposed = quietly(() => attempt(() => analyzeGrammarGating(composed)));
      entry.gatingComposed = gateComposed.value.ok
        ? {
            totalChoices: gateComposed.value.value.totalChoices,
            gated: gateComposed.value.value.gated,
            ungatedCount: gateComposed.value.value.ungated.length,
            unanalysable: gateComposed.value.value.unanalysable.map(u => ({ rule: u.rule, kind: u.kind, reason: u.reason }))
          }
        : { threw: gateComposed.value.error };

      /* --- gating on the REAL macro artifact --- */
      const gateMacro = quietly(() => attempt(() => analyzeGrammarGating(compiled)));
      entry.gatingMacro = gateMacro.value.ok
        ? {
            totalChoices: gateMacro.value.value.totalChoices,
            gated: gateMacro.value.value.gated,
            ungatedCount: gateMacro.value.value.ungated.length,
            unanalysableCount: gateMacro.value.value.unanalysable.length,
            unanalysableKinds: [...new Set(gateMacro.value.value.unanalysable.map(u => u.kind))]
          }
        : { threw: gateMacro.value.error };

      /* --- duplication, fed the PRE-COMPOSE map --- */
      const dup = quietly(() => attempt(() => analyzeDuplicationRules(allEntries, { maxFindings: 200 })));
      if (dup.value.ok) {
        const r = dup.value.value;
        entry.duplicationPreCompose = {
          stats: r.stats,
          total: duplicationFindingCount(r),
          counts: Object.fromEntries(
            ['duplicates', 'nearDuplicates', 'regexFragments', 'regexClasses', 'overlaps', 'rewrites', 'divergentNodes', 'structureLoss', 'keywordRegexes']
              .map(k => [k, r[k].length])
          ),
          report: r,
          lines: formatDuplicationFindings(r)
        };
      } else {
        entry.duplicationPreCompose = { threw: dup.value.error };
      }

      /* --- coverage, every route --- */
      const startRule = 'Stylesheet';
      entry.coverage.composedInterpreted = quietly(() => attempt(() => composedGrammarCoverageDefinitions(composed, startRule).length)).value;
      entry.coverage.compiledInterpreted = quietly(() => attempt(() => compiledGrammarCoverageDefinitions(composed).length)).value;
      entry.coverage.composedMacro = quietly(() => attempt(() => composedGrammarCoverageDefinitions(compiled, startRule).length)).value;
      entry.coverage.compiledMacro = quietly(() => attempt(() => compiledGrammarCoverageDefinitions(compiled).length)).value;
      entry.coverage.entryInterpreted = quietly(() => attempt(() => {
        const seed = allEntries.find(([k]) => k === startRule);
        if (!seed) {
          throw new Error(`no ${startRule} in pre-compose map`);
        }
        return grammarCoverageDefinitions(seed[1]).length;
      })).value;

      report.grammars.push(entry);
      console.error(`analysed ${g.dialect}/${surface}`);
    }
  }
} finally {
  await interpreted.close();
  await macro.close();
}

const outDir = resolve(ROOT, 'scripts/parseman-diagnostics/out');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, 'report.json');
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.error(`wrote ${outFile}`);
