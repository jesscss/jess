/**
 * HARNESS SELF-CHECK. Run this before trusting any board.
 *
 * Thirteen gates in this project have now been found green while checking
 * nothing. One failed open because `NaN > tol` and `NaN < -tol` are both
 * false. One reported "176 problems, 1 cause" while examining nothing. A perf
 * gate compiled each side once and reused it for twelve passes, so its
 * effective n was 1.
 *
 * A harness that has not been SHOWN TO FAIL on a known-bad input is not a
 * harness. So there are two checks and both must hold:
 *
 *   CHECK 1  current vs ITSELF        -> must PASS, zero divergences
 *   CHECK 2  current vs BROKEN variant -> must FAIL, and must NAME THE SITE
 *
 * Check 1 alone is worthless: a harness that returns "pass" unconditionally
 * satisfies it perfectly. Check 2 is the one that has teeth, and it is
 * deliberately built from the two mutations that actually bit this project:
 * a flipped dispatch key (the `'@' | 32` backtick, which 288 tests missed) and
 * a narrowed keyword set.
 *
 *   node tools/grammar-tournament/selfcheck.mjs
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { loadSurfaces, compareBuilds, formatDivergence } from './lib/identity.mjs';
import { loadCssCorpus, isMalformed } from './lib/corpus.mjs';
import { detectInterpreterFallback } from './lib/preconditions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const pkg = resolve(repo, 'packages/syntax/css/css-parser');

function heading(t) {
  console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
}

/**
 * Build the BROKEN variant by patching the COMPILED artifact, not the source.
 *
 * Patching source would need a full macro rebuild (~30 s) and, worse, a
 * mutation that fails static evaluation falls back to the interpreter and then
 * the check would be measuring the fallback rather than the mutation. Patching
 * the emitted table changes exactly one dispatch key and nothing else, which is
 * a far more faithful model of the `'@' | 32` bug: that bug was a single
 * character in one key that left everything else intact.
 */
function makeBrokenVariant(srcLibDir, dstLibDir, mutation) {
  rmSync(dstLibDir, { recursive: true, force: true });
  mkdirSync(dirname(dstLibDir), { recursive: true });
  cpSync(srcLibDir, dstLibDir, { recursive: true });

  const targets = ['grammar/ast.js', 'grammar/cst.js'];
  let patchedAny = false;
  const evidence = [];

  for (const t of targets) {
    const p = resolve(dstLibDir, t);
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    const out = mutation(text);
    if (out.text !== text) {
      writeFileSync(p, out.text);
      patchedAny = true;
      evidence.push(`${t}: ${out.note}`);
    }
  }
  return { patched: patchedAny, evidence };
}

/**
 * Corrupt the Nth occurrence of `token` in the emitted table.
 *
 * WHY BY OCCURRENCE INDEX, WHICH LOOKS FRAGILE
 * --------------------------------------------
 * Keywords do NOT survive into the artifact as quoted dispatch keys. They are
 * compiled into regex alternations, and most occurrences of a given keyword are
 * inert: they sit in negative-lookahead EXCLUSION lists that only set a token
 * BOUNDARY. Corrupting one of those changes no tree at all.
 *
 * That is not a quirk of the tooling, it is a real property of this grammar and
 * Candidate C documented it independently: the known-at-rule-name list is a
 * boundary policy, not a validity check. I verified it here the hard way —
 * all five occurrences of `font-face` were mutated one at a time, on BOTH the
 * ast and cst surfaces, and not one of them changed a tree, because
 * `@font-face` is dispatched generically and only its NAME is captured.
 *
 * So the occurrence index is not a magic number, it is the empirically located
 * LIVE dispatch site, and each is recorded with the probe that proves it live.
 * The indices are only ever applied to the INCUMBENT build, which is pinned, so
 * they cannot drift under a candidate.
 *
 * Critically: if a mutation turns out NOT to change behaviour, this check FAILS
 * LOUDLY rather than skipping. An ineffective mutation proves nothing, and a
 * self-check that quietly proves nothing is the exact failure mode — thirteen
 * gates in this project were green while checking nothing — that this file
 * exists to rule out.
 */
function corruptNth(token, n, replacement) {
  return text => {
    const positions = [];
    let i = -1;
    while ((i = text.indexOf(token, i + 1)) >= 0) {
      positions.push(i);
    }
    if (positions.length <= n) {
      return { text, note: `only ${positions.length} occurrences of ${token}; wanted #${n}` };
    }
    const at = positions[n];
    return {
      text: text.slice(0, at) + replacement + text.slice(at + token.length),
      note: `corrupted occurrence #${n} of "${token}" -> "${replacement}" at offset ${at} `
        + `(of ${positions.length} occurrences; the others are inert boundary lists)`
    };
  };
}

/**
 * Mutation A — flip a live at-rule dispatch key. The `'@' | 32` class.
 * Verified live: makes `@supports (display:grid){a{color:red}}` fail to parse.
 */
const flipDispatchKey = corruptNth('supports', 1, 'sXpports');

/**
 * Mutation B — narrow a keyword set by corrupting a reserved member.
 * Verified live: makes `@media only screen and (min-width:10px){…}` fail to
 * parse, because `only` is what selects the media-type arm.
 */
const narrowKeywordSet = corruptNth('only', 3, 'onlZ');

async function main() {
  heading('PROVENANCE');
  const parsemanVersion = JSON.parse(readFileSync(resolve(repo, 'node_modules/parseman/package.json'), 'utf8')).version;
  console.log(`repo           ${repo}`);
  console.log(`parseman       ${parsemanVersion}`);
  console.log(`package        ${pkg}`);

  const fb = detectInterpreterFallback(pkg);
  console.log(`macro-compiled ${fb.ok ? 'YES' : 'NO'}  (${fb.scanned} grammar artifacts scanned, ${fb.offenders.length} runtime parseman imports)`);
  if (!fb.ok) {
    console.error(`\nABORT: ${fb.reason}`);
    process.exit(3);
  }

  heading('CORPUS');
  const corpus = loadCssCorpus(repo);
  const malformed = corpus.ids.filter(isMalformed).length;
  console.log(`entries        ${corpus.ids.length}`);
  console.log(`  well-formed  ${corpus.ids.length - malformed}`);
  console.log(`  malformed    ${malformed}`);
  if (corpus.declaredMissing.length > 0) {
    console.log(`missing roots  ${corpus.declaredMissing.length}`);
    for (const m of corpus.declaredMissing) {
      console.log(`  - ${m}`);
    }
  }
  if (corpus.ids.length === 0) {
    console.error('\nABORT: corpus matched no files. A filter that silently matches nothing is the same failure in a different costume.');
    process.exit(3);
  }

  const baseDir = resolve(pkg, 'entries/base/lib');
  const selfDir = resolve(pkg, 'entries/selfcheck/lib');
  const brokenDir = resolve(pkg, 'entries/broken/lib');

  // ---- CHECK 1 ---------------------------------------------------------
  heading('SELF-CHECK 1 — current vs ITSELF (must PASS, zero divergences)');
  const base = await loadSurfaces(baseDir);
  const self = await loadSurfaces(selfDir);
  console.log(`surfaces       ${base.map(s => s.name).join(', ')}`);

  const r1 = compareBuilds({ base, candidate: self, corpus, renames: {}, repo });
  console.log(`pairs compared ${r1.checked}`);
  console.log(`identical-throw ${r1.bothThrew}  (weak evidence — counted separately)`);
  console.log(`real trees     ${r1.checked - r1.bothThrew}`);
  console.log(`verdict        ${r1.verdict.toUpperCase()}  divergences=${r1.divergenceCount ?? r1.divergences.length}`);
  if (r1.undigested.length > 0) {
    console.log(`undigested     ${r1.undigested.length}`);
    for (const u of r1.undigested.slice(0, 5)) {
      console.log(`  - ${u.surface} ${u.id}: ${u.error}`);
    }
  }
  const check1 = r1.verdict === 'pass';
  console.log(check1 ? '\nCHECK 1 OK — identical builds compare identical.' : '\nCHECK 1 FAILED — the harness reports divergence between two copies of one build.');

  // ---- CHECK 2 ---------------------------------------------------------
  heading('SELF-CHECK 2 — current vs BROKEN (must FAIL and NAME THE SITE)');
  const results = [];
  for (const [label, mutation, expectSite] of [
    ['flipped dispatch key (the \'@\' | 32 class)', flipDispatchKey, 'supports'],
    ['narrowed keyword set', narrowKeywordSet, 'media']
  ]) {
    const made = makeBrokenVariant(baseDir, brokenDir, mutation);
    console.log(`\n--- mutation: ${label} ---`);
    if (!made.patched) {
      console.log('  SKIPPED — mutation found no site to patch in the artifact');
      results.push({ label, ok: false, reason: 'no site patched' });
      continue;
    }
    for (const e of made.evidence) {
      console.log(`  ${e}`);
    }

    const broken = await loadSurfaces(brokenDir);
    const r2 = compareBuilds({ base, candidate: broken, corpus, renames: {}, repo, limitReports: 3 });
    const count = r2.divergenceCount ?? r2.divergences.length;
    console.log(`  verdict ${r2.verdict.toUpperCase()}  divergences=${count} / ${r2.checked} pairs`);
    for (let i = 0; i < r2.divergences.length; i++) {
      console.log(formatDivergence(r2.divergences[i], i + 1));
    }
    /*
     * "Named the right site" means the first reported divergence is on an
     * input that actually EXERCISES the mutated construct. Checking the
     * divergence record for the keyword would be checking the wrong thing:
     * the record names the tree position, not the css. So read the input.
     */
    const named = r2.divergences.some(d => {
      try {
        return corpus.read(d.id).includes(`@${expectSite}`);
      } catch {
        return false;
      }
    });
    const ok = r2.verdict === 'fail' && count > 0;
    console.log(`  -> ${ok ? 'DETECTED' : 'MISSED'}${ok ? (named ? ', and named the right site' : ', but did not name the expected site in the first reports') : ''}`);
    results.push({ label, ok, named, count });
  }

  rmSync(brokenDir, { recursive: true, force: true });

  heading('SUMMARY');
  console.log(`CHECK 1 (identical -> pass) : ${check1 ? 'OK' : 'FAILED'}`);
  for (const r of results) {
    console.log(`CHECK 2 (${r.label}) : ${r.ok ? `OK — ${r.count} divergences` : 'FAILED'}${r.named ? ' [site named]' : ''}`);
  }
  const allOk = check1 && results.every(r => r.ok);
  console.log(`\nHARNESS ${allOk ? 'TRUSTWORTHY' : 'NOT TRUSTWORTHY'}`);
  process.exit(allOk ? 0 : 1);
}

await main();
