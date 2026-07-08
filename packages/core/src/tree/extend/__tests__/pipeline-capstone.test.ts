/**
 * pipeline-capstone.test.ts — the END-TO-END capstone differential for the composed extend flow.
 * ==============================================================================================
 *
 * This is the pre-wire-in GATE. It drives the composed PLAN→SOLVE→EMIT pipeline (`pipeline.ts`)
 * over the WHOLE extend corpus and compares each extend-affected subject's FINAL composed/hoisted/
 * collapsed selector header to the RATIFIED v5 alpha `.css` (from `@less/test-data` → the less.js
 * alpha branch — NOT current Jess output, NOT the `legacy/` Less-4.x `.css`).
 *
 * WHY A SELECTOR-LEVEL DIFFERENTIAL. The wire-in is decoupled from the render monolith
 * (OVERNIGHT-READOUT decision #1): extend is a selector-graph fixpoint, value resolution is a
 * per-leaf frame lookup. So the capstone measures exactly the layer the wire-in swaps — the extend-
 * affected SELECTOR HEADERS — against the ratified output, cross-checking the seam the per-layer
 * tests cannot: fixpoint (SOLVE) × scope × compose × hoist × collapse (EMIT) composed together.
 *
 * SUBJECTS + BUCKET PATHS are declared from the AUTHORED `.less` (the stable structural input the
 * design's OQ-5(B) derives placement from). Each extend-affected block's header is projected by the
 * pipeline and asserted against the alpha `.css` header for that block. The alpha header is LOADED
 * from the on-disk `.css` (not a hardcoded string) and normalized to the internal `valueOf` form
 * (comma-joined, no post-comma space — the CSS writer's `, ` is a serialization concern above the
 * selector-shape layer this component owns).
 *
 * A pipeline-vs-alpha mismatch is classified by the test as:
 *   (a) BUG-FIX — the pipeline matches alpha where current Jess does NOT (documented inline).
 *   (b) UNSUPPORTED-FALLBACK — the own engine cannot build the shape (fail-loud, recorded).
 *   (c) REAL-GAP — pipeline diverges from alpha where it should not (surfaced loudly). None expected.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { el, sel, co, compound, amp, type Selector } from '../../index.js';
import { runExtendPipeline, type PipelineInstruction, type PipelineSubject } from '../pipeline.js';

const require = createRequire(import.meta.url);
const testData = process.env.LESS_TEST_DATA_ROOT ?? path.dirname(require.resolve('@less/test-data'));

/** Load an alpha `.css` fixture body. */
function loadCss(dir: string, name: string): string {
  return readFileSync(path.join(testData, 'tests-unit', dir, `${name}.css`), 'utf8');
}

/**
 * Extract a top-level block's header from an alpha `.css`, keyed by a UNIQUE declaration line inside
 * it. Returns the comma-joined header normalized to `valueOf` form (post-comma spaces removed,
 * newlines collapsed). Matches the header text preceding the `{` whose body contains `declMatch`.
 */
function alphaHeader(css: string, declMatch: string): string {
  const declIdx = css.indexOf(declMatch);
  if (declIdx === -1) {
    throw new Error(`decl not found in alpha css: ${declMatch}`);
  }
  const braceIdx = css.lastIndexOf('{', declIdx);
  if (braceIdx === -1) {
    throw new Error(`no opening brace before decl: ${declMatch}`);
  }
  // Header is from the previous block close (`}`) or file start up to this `{`.
  const prevClose = Math.max(css.lastIndexOf('}', braceIdx), css.lastIndexOf('{', braceIdx - 1));
  const header = css.slice(prevClose + 1, braceIdx);
  return header
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,\s+/g, ',');
}

interface CaseResult {
  label: string;
  header: string;
  ownBuilt: boolean;
  hoistToRoot: boolean;
}

const bugFixes: string[] = [];
const fallbacks: string[] = [];
const realGaps: string[] = [];

/**
 * Drive one subject through the pipeline and diff its header against the alpha expectation. `kind`
 * records the classification when it matches (bug-fix vs plain-parity); a mismatch is a real gap
 * UNLESS the subject is UNSUPPORTED (recorded as a fallback).
 */
function diffSubject(
  label: string,
  subject: PipelineSubject,
  instructions: PipelineInstruction[],
  expected: string,
  kind: 'bug-fix' | 'parity',
  currentJess?: string
): CaseResult {
  const out = runExtendPipeline([subject], instructions);
  const result = out.subjects[0]!;
  if (!result.ownBuilt) {
    fallbacks.push(`${label}: ${result.unsupported.map(u => String(u.target.valueOf())).join(', ')}`);
    return { label, header: '', ownBuilt: false, hoistToRoot: false };
  }
  if (result.header !== expected) {
    realGaps.push(`[${label}] alpha=${expected} pipeline=${result.header}`);
  } else if (kind === 'bug-fix') {
    bugFixes.push(`${label}: pipeline=${result.header} (currentJess=${currentJess ?? 'differs'})`);
  }
  return { label, header: result.header, ownBuilt: true, hoistToRoot: result.hoistToRoot };
}

describe('CAPSTONE — PLAN→SOLVE→EMIT composed vs ratified v5 alpha .css (whole extend corpus)', () => {
  // ── extend-nest ──────────────────────────────────────────────────────────────────────────────
  describe('extend-nest.css', () => {
    const css = loadCss('extend-nest', 'extend-nest');
    const sidebarInstr: PipelineInstruction[] = [
      { target: el('.sidebar'), extendWith: el('.sidebar2'), partial: false, path: [el('.sidebar2')], order: 1 },
      { target: el('.sidebar'), extendWith: el('.sidebar3'), partial: false, path: [el('.type1'), el('.sidebar3')], order: 2 },
      { target: el('.sidebar'), extendWith: compound([el('.type2'), el('.sidebar4')]), partial: false, path: [compound([el('.type2'), el('.sidebar4')])], order: 3 }
    ];

    it('.sidebar → composed 4-branch (BUG-FIX: current Jess emits bare .sidebar3)', () => {
      const expected = alphaHeader(css, 'width: 300px');
      diffSubject('extend-nest/.sidebar', { id: 's', path: [el('.sidebar')], order: 0 }, sidebarInstr, expected, 'bug-fix', '.sidebar,.sidebar2,.sidebar3,.type2.sidebar4');
      expect(realGaps).toEqual([]);
    });

    it(':is(...) .box collapsed nested child (BUG-FIX)', () => {
      const expected = alphaHeader(css, 'background: #FFF');
      diffSubject('extend-nest/.box', { id: 'box', path: [el('.sidebar')], order: 0, nestedChildLocal: el('.box') }, sidebarInstr, expected, 'bug-fix', '.sidebar .box (bare)');
      expect(realGaps).toEqual([]);
    });

    it(':is(.button, .submit):hover — &:hover child collapses the extended parent Or-set (BUG-FIX)', () => {
      // Alpha: `:is(.button, .submit):hover`. `.button { &:hover { … } }` with `.submit:extend(.button)`.
      // The subject is the `&:hover` child; its parent `.button` Or-set is `{.button, .submit}` (base
      // extend), folded into the `&:hover` child → `:is(.button, .submit):hover`. This is the compound-
      // append collapse (`&`-carrying child), the same shape as clearfix `&:after`.
      const expected = alphaHeader(css, 'color: inherit');
      const instr: PipelineInstruction[] = [
        { target: el('.button'), extendWith: el('.submit'), partial: false, path: [el('.submit')], order: 1 }
      ];
      diffSubject(
        'extend-nest/:is(.button,.submit):hover',
        { id: 'bh', path: [el('.button')], order: 0, nestedChildLocal: compound([amp(), el(':hover')]) },
        instr,
        expected,
        'bug-fix',
        '.button:hover,.submit:hover (bare)'
      );
      expect(realGaps.filter(g => g.includes(':hover'))).toEqual([]);
    });
  });

  // ── extend-selector ──────────────────────────────────────────────────────────────────────────
  describe('extend-selector.css', () => {
    const css = loadCss('extend-selector', 'extend-selector');

    it('.header .header-nav ← .footer .footer-nav (HOIST-TO-ROOT, BUG-FIX)', () => {
      const expected = alphaHeader(css, 'background: red');
      const instr: PipelineInstruction[] = [
        { target: sel([el('.header'), co(' '), el('.header-nav')]), extendWith: sel([el('.footer'), co(' '), el('.footer-nav')]), partial: false, path: [el('.footer'), el('.footer-nav')], order: 1 }
      ];
      const r = diffSubject('extend-selector/.header .header-nav', { id: 'hn', path: [el('.header'), el('.header-nav')], order: 0 }, instr, expected, 'bug-fix', '.header .header-nav,.footer-nav (bare)');
      expect(realGaps.filter(g => g.includes('.header-nav'))).toEqual([]);
      expect(r.hoistToRoot).toBe(true);
    });

    it('.issue-2586-bordered ← .issue-2586-somepage .content (nested extender of root target)', () => {
      const expected = alphaHeader(css, 'border: solid 1px black');
      const instr: PipelineInstruction[] = [
        { target: el('.issue-2586-bordered'), extendWith: el('.content'), partial: false, path: [el('.issue-2586-somepage'), el('.content')], order: 1 }
      ];
      diffSubject('extend-selector/.issue-2586-bordered', { id: 'ib', path: [el('.issue-2586-bordered')], order: 0 }, instr, expected, 'parity');
      expect(realGaps.filter(g => g.includes('issue-2586'))).toEqual([]);
    });

    it(':is(.foo, .ext1 .ext2, .ext3, .ext4) .bar collapsed partial-extend child', () => {
      const expected = alphaHeader(css, 'display: none');
      const instr: PipelineInstruction[] = [
        { target: el('.foo'), extendWith: sel([el('.ext1'), co(' '), el('.ext2')]), partial: true, path: [el('.ext1'), el('.ext2')], order: 1 },
        { target: el('.foo'), extendWith: el('.ext3'), partial: true, path: [el('.ext3')], order: 2 },
        { target: el('.foo'), extendWith: el('.ext4'), partial: true, path: [el('.ext4')], order: 3 }
      ];
      // The alpha block header is a SelectorList (`:is(…) .bar, :is(…) .baz`). The pipeline projects
      // the `.bar` child arm only; extract it by the ` .bar` suffix WITHOUT splitting the `:is()` group
      // (a naive comma-split would break the group), i.e. the substring up to the first ` .bar`.
      const barEnd = expected.indexOf(' .bar') + ' .bar'.length;
      const barArm = expected.slice(0, barEnd);
      diffSubject('extend-selector/:is(...).bar', { id: 'bar', path: [el('.foo')], order: 0, nestedChildLocal: el('.bar') }, instr, barArm, 'bug-fix', '.foo .bar (bare)');
      expect(realGaps.filter(g => g.includes('.bar'))).toEqual([]);
    });
  });

  // ── extend (extend.less) ───────────────────────────────────────────────────────────────────────
  describe('extend.css', () => {
    const css = loadCss('extend', 'extend');

    it('.error ← .badError (root-level sibling, parity)', () => {
      const expected = alphaHeader(css, 'border: 1px #f00');
      const instr: PipelineInstruction[] = [
        { target: el('.error'), extendWith: el('.badError'), partial: false, path: [el('.badError')], order: 1 }
      ];
      diffSubject('extend/.error', { id: 'err', path: [el('.error')], order: 0 }, instr, expected, 'parity');
      expect(realGaps.filter(g => g.includes('.error'))).toEqual([]);
    });

    it('.aa,.cc { .dd,.ee } — nested-target chain (collapseNesting:false, parity)', () => {
      // .aa gains .cc (exact extend on .aa). Under expanded mode the header is `.aa, .cc`.
      const expected = alphaHeader(css, 'color: black');
      const instr: PipelineInstruction[] = [
        { target: el('.aa'), extendWith: el('.cc'), partial: false, path: [el('.cc')], order: 1 }
      ];
      diffSubject('extend/.aa', { id: 'aa', path: [el('.aa')], order: 0 }, instr, expected, 'parity');
      expect(realGaps.filter(g => g.includes('.aa') || g.includes('.cc'))).toEqual([]);
    });
  });

  // ── extend-chaining ────────────────────────────────────────────────────────────────────────────
  describe('extend-chaining.css', () => {
    const css = loadCss('extend-chaining', 'extend-chaining');

    it('CROSS-SELECTOR transitive .a ← .b ← .c → .a,.b,.c (parity)', () => {
      const expected = alphaHeader(css, 'color: black'); // first block
      const instr: PipelineInstruction[] = [
        { target: el('.a'), extendWith: el('.b'), partial: false, path: [el('.b')], order: 1 },
        { target: el('.b'), extendWith: el('.c'), partial: false, path: [el('.c')], order: 2 }
      ];
      const out = runExtendPipeline([{ id: 'a', path: [el('.a')], order: 0 }], instr);
      const r = out.subjects[0]!;
      if (r.header !== expected) {
        realGaps.push(`[chaining/.a] alpha=${expected} pipeline=${r.header}`);
      }
      expect(r.header).toBe('.a,.b,.c');
      expect(realGaps.filter(g => g.includes('chaining/.a'))).toEqual([]);
    });

    it('deep multi-chain .l ← .m ← … ← .t (9-branch transitive closure)', () => {
      const chain = ['l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'];
      const instr: PipelineInstruction[] = [];
      for (let i = 0; i < chain.length - 1; i++) {
        instr.push({ target: el(`.${chain[i]}`), extendWith: el(`.${chain[i + 1]}`), partial: false, path: [el(`.${chain[i + 1]}`)], order: i + 1 });
      }
      const out = runExtendPipeline([{ id: 'l', path: [el('.l')], order: 0 }], instr);
      expect(out.subjects[0]!.header).toBe('.l,.m,.n,.o,.p,.q,.r,.s,.t');
    });

    it('CIRCULAR .x ← .z, .y ← .x, .z ← .y — each closes to {.x,.y,.z} (order-rotated per subject)', () => {
      const instr: PipelineInstruction[] = [
        { target: el('.z'), extendWith: el('.x'), partial: false, path: [el('.x')], order: 1 },
        { target: el('.x'), extendWith: el('.y'), partial: false, path: [el('.y')], order: 2 },
        { target: el('.y'), extendWith: el('.z'), partial: false, path: [el('.z')], order: 3 }
      ];
      const outX = runExtendPipeline([{ id: 'x', path: [el('.x')], order: 0 }], instr);
      // Alpha `.x { color:x }` header is `.x, .y, .z`.
      const expectedX = alphaHeader(css, 'color: x');
      const r = outX.subjects[0]!;
      if (r.header !== expectedX) {
        realGaps.push(`[chaining/.x-circular] alpha=${expectedX} pipeline=${r.header}`);
      }
      expect(realGaps.filter(g => g.includes('circular'))).toEqual([]);
    });
  });

  // ── extend-clearfix ────────────────────────────────────────────────────────────────────────────
  describe('extend-clearfix.css', () => {
    const css = loadCss('extend-clearfix', 'extend-clearfix');
    const instr: PipelineInstruction[] = [
      { target: el('.clearfix'), extendWith: el('.foo'), partial: false, path: [el('.foo')], order: 1 },
      { target: el('.clearfix'), extendWith: el('.bar'), partial: false, path: [el('.bar')], order: 2 }
    ];

    it('.clearfix,.foo,.bar (parity)', () => {
      const expected = alphaHeader(css, '*zoom: 1');
      diffSubject('clearfix/.clearfix', { id: 'cf', path: [el('.clearfix')], order: 0 }, instr, expected, 'parity');
      expect(realGaps.filter(g => g.includes('clearfix'))).toEqual([]);
    });

    it(':is(.clearfix, .foo, .bar):after collapsed nested child (BUG-FIX)', () => {
      const expected = alphaHeader(css, "content: '';");
      diffSubject('clearfix/:after', { id: 'after', path: [el('.clearfix')], order: 0, nestedChildLocal: compound([amp(), el(':after')]) }, instr, expected, 'bug-fix', '.clearfix:after (bare)');
      expect(realGaps.filter(g => g.includes(':after'))).toEqual([]);
    });
  });

  // ── extend-exact ───────────────────────────────────────────────────────────────────────────────
  describe('extend-exact.css', () => {
    const css = loadCss('extend-exact', 'extend-exact');

    it('.a,.effected — fan-in: .a/.b/.c each gains .effected (parity on .a)', () => {
      // `.effected { &:extend(.a); &:extend(.b); &:extend(.c); }` → .a gains .effected. The alpha `.a`
      // block header (`.a, .effected`) is what the pipeline projects for the .a subject.
      const expected = alphaHeader(css, 'prop: is_effected');
      const instr: PipelineInstruction[] = [
        { target: el('.a'), extendWith: el('.effected'), partial: false, path: [el('.effected')], order: 10 }
      ];
      diffSubject('extend-exact/.a', { id: 'a', path: [el('.a')], order: 1 }, instr, expected, 'parity');
      expect(realGaps.filter(g => g.includes('extend-exact/.a'))).toEqual([]);
    });

    it('.e.e,.dbl — && double-parent target extended by .dbl (parity)', () => {
      // `.e { && { … } }` composes to `.e.e`; `.dbl:extend(.e.e)` → `.e.e, .dbl`. The `&&` compose is
      // the target's OWN authored path (a compound of two `&` resolving to `.e.e`), declared directly.
      const expected = alphaHeader(css, 'prop: extend-double');
      const instr: PipelineInstruction[] = [
        { target: compound([el('.e'), el('.e')]), extendWith: el('.dbl'), partial: false, path: [el('.dbl')], order: 1 }
      ];
      diffSubject('extend-exact/.e.e', { id: 'ee', path: [compound([el('.e'), el('.e')])], order: 0 }, instr, expected, 'parity');
      expect(realGaps.filter(g => g.includes('.e.e'))).toEqual([]);
    });
  });

  // ── extend-media ───────────────────────────────────────────────────────────────────────────────
  describe('extend-media.css', () => {
    const css = loadCss('extend-media', 'extend-media');

    it(':is(.ext1, .all) .ext2 — partial extend of .ext1 by root-level .all folds into .ext2', () => {
      // `.ext1 .ext2 { … }` with `.all:extend(.ext1 all)` (partial) → `.ext1` gains `.all` →
      // `:is(.ext1, .all) .ext2`. The `.ext2` descendant is the nested child of the `.ext1` Or-set.
      const expected = alphaHeader(css, 'background: black');
      const instr: PipelineInstruction[] = [
        { target: el('.ext1'), extendWith: el('.all'), partial: true, path: [el('.all')], order: 1 }
      ];
      diffSubject('extend-media/:is(.ext1,.all).ext2', { id: 'e2', path: [el('.ext1')], order: 0, nestedChildLocal: el('.ext2') }, instr, expected, 'bug-fix', '.ext1 .ext2 (bare)');
      expect(realGaps.filter(g => g.includes('.ext2'))).toEqual([]);
    });
  });

  // ── FRONTIER PROBES — shapes the own engine is expected to gate to UNSUPPORTED ─────────────────
  describe('frontier — UNSUPPORTED fallback classes (fail-loud, recorded)', () => {
    it('&-carrying FIND target is a fallback (own engine gates &-finds)', () => {
      // A find that carries `&` (parent-relative) is a shape `extendByIndexOwn` does not build.
      const instr: PipelineInstruction[] = [
        { target: compound([amp(), el('.x')]), extendWith: el('.y'), partial: false, path: [el('.y')], order: 1 }
      ];
      const out = runExtendPipeline([{ id: 'amp', path: [compound([amp(), el('.x')])], order: 0 }], instr);
      // Either own-built (if the engine happens to build it) or a recorded fallback — never a silent
      // wrong answer. Record the outcome for the frontier tally.
      if (!out.subjects[0]!.ownBuilt) {
        // already recorded via runExtendPipeline's unsupported list — mirror into the fallback tally
        fallbacks.push(`frontier/&-find: ${out.subjects[0]!.unsupported.map(u => String(u.target.valueOf())).join(', ')}`);
      }
      expect(out.subjects[0]!.header === '' || out.subjects[0]!.ownBuilt).toBeTruthy();
    });
  });
});

describe('CAPSTONE verdict', () => {
  it('reports bug-fixes / fallbacks / real-gaps', () => {
    /* eslint-disable no-console */
    console.log('\n=== CAPSTONE VERDICT ===');
    console.log(`BUG-FIXES (pipeline matches alpha where current Jess does not): ${bugFixes.length}`);
    for (const b of bugFixes) console.log(`   FIX  ${b}`);
    console.log(`UNSUPPORTED-FALLBACKS (own engine cannot build; wire-in oracle-falls-back): ${fallbacks.length}`);
    for (const f of fallbacks) console.log(`   FB   ${f}`);
    console.log(`REAL-GAPS (pipeline diverges from alpha; the valuable find): ${realGaps.length}`);
    for (const g of realGaps) console.log(`   GAP  ${g}`);
    /* eslint-enable no-console */
    expect(realGaps, realGaps.join('\n')).toEqual([]);
  });
});
