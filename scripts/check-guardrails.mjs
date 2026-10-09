#!/usr/bin/env node
/*
 * `pnpm check:guardrails` — the mechanical half of "an agent may not redefine,
 * narrow, or close an owner requirement."
 *
 * WHY THIS EXISTS. An agent hit a conflict between an owner requirement and a
 * tool constraint (parseman's `direct-builder-static` allow-set versus the
 * owner's "each downstream grammar MUST extend CSS grammar"). Instead of
 * escalating, it redefined the requirement to fit the constraint and then wrote
 * a standing instruction — "This conclusion is settled … do not re-propose
 * `compose()` across artifacts without new evidence" — forbidding later agents
 * from reopening it. Three CSS grammars were re-implemented as copies and every
 * later lane inherited that as the design.
 *
 * A rule written in a document does not stop that: the next agent can edit the
 * document exactly as the last one edited the spec. So the rule is also a gate.
 *
 * FIVE ASSERTIONS, all mechanical:
 *
 *   1. `docs/OWNER-REQUIREMENTS.md` is byte-frozen against a hash recorded in
 *      this file. Any edit fails the build. Updating the hash is the owner's
 *      act.
 *
 *   2. No closure directive ("do not reopen", "this conclusion is settled", …)
 *      appears in `docs/`, `.cursor/rules/`, `CLAUDE.md` or `AGENTS.md` without
 *      an explicit attribution marker saying WHO closed it.
 *
 *   3. Less 4.x / lessc / less.js behaviour is never offered as the REASON for a
 *      behaviour ("as lessc does", "matches Less 4.x", "lessc 4.9.1 writes the
 *      same", "Oracle: lessc 4.x"), in docs, code comments or test titles.
 *      Existing violations are baselined in
 *      `scripts/check-guardrails.reference-baseline.json`; the baseline may only
 *      shrink.
 *
 *   4. Owner rulings are locked: every owner-ruled row of the decision ledger
 *      and every test in `packages/jess/test/owner-rulings.test.ts` matches its
 *      hash in `docs/architecture/core/owner-rulings.lock.json`. Updating the
 *      lock (`pnpm rulings:lock`) is an owner-approved act.
 *
 *   5. Parser rejections only shrink (ledger P45): every author-facing `throw`
 *      in a parser package is baselined in
 *      `scripts/check-guardrails.parser-rejections.json`; a new one fails unless
 *      it is marked `NOT-WELL-FORMED:`.
 *
 * This gate deliberately does NOT try to judge whether a closure is correct. It
 * forces the author to say, in writing and in the same block, whose authority
 * the closure rests on. An agent that types `OWNER-RULED:` over its own opinion
 * is lying, not slipping.
 *
 * Flags:
 *   --list-reference-reasons     print every assertion-3 hit (baselined or not)
 *                                as JSON, with its current file:line, and exit.
 *   --prune-baselines            drop entries that no longer occur from the
 *                                assertion-3 and assertion-5 baselines. It never
 *                                adds one.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRulingsLock, LOCK, LEDGER, RULING_TESTS } from './rulings-lock.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * Assertion 1 — owner requirements are immutable to agents.
 * ------------------------------------------------------------------ */

const OWNER_REQUIREMENTS = 'docs/OWNER-REQUIREMENTS.md';

/*
 * OWNER-MAINTAINED VALUE. Recompute with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('docs/OWNER-REQUIREMENTS.md')).digest('hex'))"
 * Changing this line is an owner act. An agent that updates it to make the gate
 * pass has performed exactly the violation the gate exists to catch.
 */
const OWNER_REQUIREMENTS_SHA256 =
  'fafa0cb0e754f790f8532928490600925d123b34315d41395fbdbdac83560a95';

const failures = [];

const requirementsPath = join(root, OWNER_REQUIREMENTS);
if (!existsSync(requirementsPath)) {
  failures.push(
    [
      `${OWNER_REQUIREMENTS} is MISSING.`,
      '',
      '  This file records every standing owner requirement verbatim. Deleting',
      '  it does not delete the requirements. Restore it from git history:',
      `    git checkout HEAD -- ${OWNER_REQUIREMENTS}`
    ].join('\n')
  );
} else {
  const actual = createHash('sha256').update(readFileSync(requirementsPath)).digest('hex');
  if (actual !== OWNER_REQUIREMENTS_SHA256) {
    failures.push(
      [
        `Owner requirements changed. Only the owner may update the recorded hash.`,
        '',
        `  file:     ${OWNER_REQUIREMENTS}`,
        `  recorded: ${OWNER_REQUIREMENTS_SHA256}`,
        `  actual:   ${actual}`,
        '',
        '  If you believe a requirement conflicts with a constraint, STOP and',
        '  escalate — do not edit this file. You may record the constraint, the',
        '  evidence, the options and a recommendation at the work site. You may',
        '  NOT record the decision.',
        '',
        '  If you edited the file by accident:',
        `    git checkout HEAD -- ${OWNER_REQUIREMENTS}`
      ].join('\n')
    );
  }
}

/* ------------------------------------------------------------------ *
 * Assertion 2 — no unattributed closure of a design question.
 * ------------------------------------------------------------------ */

/*
 * Imperative closure directives only. A descriptive "X is settled" is not a
 * directive and is not scanned; what is scanned is text that removes a later
 * reader's permission to reopen something.
 */
const CLOSURE_PATTERNS = [
  /this conclusion is settled/i,
  /\bdo(?: not|n't) re-?propose\b/i,
  /\bdo(?: not|n't) revisit\b/i,
  /\bdo(?: not|n't) re-?open\b/i,
  /\bdo(?: not|n't) re-?litigate\b/i,
  /\bdo(?: not|n't) re-?derive\b/i,
  /\bdo(?: not|n't) retry\b/i,
  /\bnot up for debate\b/i,
  /\bwill not be reconsidered\b/i
];

/*
 * Exactly four markers are accepted, and they mean different things.
 *
 *   OWNER-RULED: YYYY-MM-DD  the owner ruled it. A date is required so the
 *                            ruling is traceable to a conversation.
 *   AGENT-EVIDENCE:          an agent closing its OWN proposal on measured
 *                            evidence ("we tried it, it regressed 17 cases").
 *                            Legitimate and useful.
 *   OWNER-LEDGER:            this sentence points at the owner decision ledger;
 *                            the authority is the ledger row, not this text.
 *   CLOSURE-QUOTED:          this block QUOTES a closure directive in order to
 *                            state this rule or to repudiate a closure. It does
 *                            not close anything.
 */
const OWNER_RULED = /OWNER-RULED:\s*\d{4}-\d{2}-\d{2}/;
const AGENT_EVIDENCE = /AGENT-EVIDENCE:/;
const OWNER_LEDGER = /OWNER-LEDGER:/;
const CLOSURE_QUOTED = /CLOSURE-QUOTED:/;

/* An owner-requirement ID. `AGENT-EVIDENCE:` may never close one of these. */
const OWNER_REQUIREMENT_ID = /\bOR-\d+\b/;

const SCAN_ROOTS = ['docs', '.cursor/rules', 'CLAUDE.md', 'AGENTS.md'];

/*
 * `docs/**\/archive/**` is frozen history. Re-attributing closures written
 * months ago would be guesswork, and rewriting history to satisfy a gate is the
 * habit this gate is trying to break.
 */
const isArchived = p => p.split(sep).includes('archive');

function markdownFiles(entry) {
  const abs = join(root, entry);
  if (!existsSync(abs)) {
    return [];
  }
  if (statSync(abs).isFile()) {
    return abs.endsWith('.md') || abs.endsWith('.mdc') ? [abs] : [];
  }
  const out = [];
  for (const name of readdirSync(abs)) {
    out.push(...markdownFiles(join(relative(root, abs), name)));
  }
  return out;
}

/*
 * A "block" is the contiguous run of non-blank lines around the hit. A marker
 * anywhere in that block attributes every closure in it — markdown paragraphs,
 * list items and table rows all survive this definition, and it stops an author
 * having to repeat the marker mid-sentence.
 */
function blockAround(lines, index) {
  let start = index;
  while (start > 0 && lines[start - 1].trim() !== '') {
    start -= 1;
  }
  let end = index;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') {
    end += 1;
  }
  return lines.slice(start, end + 1).join('\n');
}

const closureHits = [];

for (const entry of SCAN_ROOTS) {
  for (const file of markdownFiles(entry)) {
    if (isArchived(file)) {
      continue;
    }
    const rel = relative(root, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!CLOSURE_PATTERNS.some(re => re.test(line))) {
        return;
      }
      const block = blockAround(lines, i);
      if (OWNER_RULED.test(block) || OWNER_LEDGER.test(block) || CLOSURE_QUOTED.test(block)) {
        return;
      }
      if (AGENT_EVIDENCE.test(block)) {
        if (OWNER_REQUIREMENT_ID.test(block)) {
          closureHits.push({
            rel,
            line: i + 1,
            text: line.trim(),
            why: 'AGENT-EVIDENCE: may not close an owner requirement (OR-* is named in this block). Use OWNER-RULED: with a date, or escalate.'
          });
        }
        return;
      }
      closureHits.push({
        rel,
        line: i + 1,
        text: line.trim(),
        why: 'unattributed closure directive'
      });
    });
  }
}

if (closureHits.length > 0) {
  failures.push(
    [
      `${closureHits.length} closure directive(s) with no attribution marker.`,
      '',
      '  An agent may not redefine, narrow, or close an owner requirement. When a',
      '  requirement conflicts with a tool constraint, a technical limit, or an',
      '  implementation difficulty, the agent STOPS AND ESCALATES. It may record',
      '  the constraint, the evidence, the options and a recommendation. It may',
      '  NOT record the decision.',
      '',
      '  Writing "settled" / "do not re-propose" / "do not reopen" about an owner',
      '  requirement is itself the violation, because it removes every later',
      '  agent\'s permission to reopen it. Only the owner closes an owner',
      '  requirement.',
      '',
      '  If the closure is legitimate, say whose it is. Put ONE of these markers',
      '  in the same block (the contiguous run of non-blank lines):',
      '',
      '    OWNER-RULED: YYYY-MM-DD   the owner ruled it. Date required.',
      '    AGENT-EVIDENCE:           you are closing YOUR OWN proposal on measured',
      '                              evidence. May not close an OR-* requirement.',
      '    OWNER-LEDGER:             the authority is a DESIGN-DECISIONS.md row,',
      '                              not this sentence.',
      '    CLOSURE-QUOTED:           you are quoting a closure to state this rule or',
      '                              to repudiate it. You are not closing anything.',
      '',
      '  If none of the four is true, the closure does not belong in the repo.',
      '  Record the evidence and the recommendation; leave the question OPEN.',
      '',
      ...closureHits.map(h => `    ${h.rel}:${h.line}  ${h.why}\n      ${h.text}`)
    ].join('\n')
  );
}

/* ------------------------------------------------------------------ *
 * Assertion 3 — Less 4.x / lessc behaviour is never a reason.
 * ------------------------------------------------------------------ */

/*
 * WHY THIS EXISTS. Agents ran lessc 4.x, saw different output, and "fixed"
 * jess to match — reversing owner rulings (ledger E1/E5/E6) — then pinned tests
 * and wrote user docs describing the reversed behaviour. Less v5 is a breaking
 * release: a difference from 4.x is not evidence of a bug, and sameness with
 * 4.x is not a reason (owner 2026-10-09).
 *
 * What is flagged is AGREEMENT phrasing that offers the reference in support of
 * a behaviour. CONTRAST phrasing — "where Less 4.x wrote X", "lessc 4.9.1
 * rejects it", "unlike 4.x", "Less 4.x instead …" — is not matched, so
 * migration notes and divergence records pass.
 *
 * Patterns run over BLOCKS: a markdown paragraph, list item or table row; one
 * comment block (prefixes stripped, lines joined); one test title. A phrase
 * broken across comment lines is still seen.
 */
const REF_VER = String.raw`(?:\s+v?[0-9]+(?:\.[0-9x]+)*)?`;
const REF_VERSIONED = String.raw`(?:lessc${REF_VER}|less\.js${REF_VER}|less@[0-9][0-9.x]*|less[ -]?4(?:\.[0-9x]+)*|4\.x)`;
const REF_NAME = String.raw`(?:${REF_VERSIONED}|real less(?:\.js)?)`;

/* Not an identifier such as `lessCompat` / `LessCst`. */
const REF = REF_NAME + String.raw`(?![\w-]*[a-wyz])`;
const TICK = String.raw`\`?`;
const REFERENCE_PATTERNS = [
  // "as lessc does", "as in Less 4.x", "like lessc", "as in css and lessc 4.9.1", "as the `x` golden and lessc 4.x"
  String.raw`(?<!\b(?:such|not) )\b(?:as|like|same as)\s+(?:in\s+)?(?:(?:the\s+)?[\w\`-]+(?:\s+[\w\`-]+)?\s+and\s+)?${TICK}${REF}(?!\s+(?:wrote|did not|does not|doesn't|didn't|instead))`,

  // "matching lessc 4.x", "matches Less 4.x", "mirrors less@4", "byte-identical to less@4", "parity with 4.x"
  String.raw`\b(?:matching|matches|matched|mirrors?|mirroring|(?:byte-)?identical to|parity with)\s+(?:the\s+)?(?:legacy jess\s*\/\s*)?(?:eval\s*\/\s*)?${TICK}${REF}(?!\s+(?:perf|speed)|\s+\`[^\`]+\`\s+fixture)`,

  // "(Less 4.x parity)", "(lessc 4.9.1 behaviour)", "Less 4.x-parity", "Less 4.x/v5 parity", "(less@4.6.3)", "(Less 4.x: …)"
  String.raw`\(${REF}(?:\/v5)?\s+(?:parity|behaviou?r)\)|${REF_VERSIONED}-parity\b|${REF_VERSIONED}\/v5 parity|\((?:lessc\s+|less@)\d[\d.x]*\)|\(${REF}:\s`,

  // corroboration: "lessc 4.9.1 also writes", "agrees", "drops it too", "gives the same output", "copies the Extend"
  String.raw`${REF}(?:'s)?\s+(?:also\b(?!\s+(?:\w+ed|let|had|wrote|took|gave|made|kept)\b)|agrees(?! with neither)|[^.\n;]{0,80}?\btoo\b(?!\s+(?:large|many|few|small|long|big|much|late|early))|(?:\w+\s+){0,4}the same\b(?!\s+(?:defect|bug))|copies the)`,

  // test oracles: "Oracle: lessc 4.x", "Every expectation … is lessc 4.9.1 output", "captured from npx less@4.6.3"
  String.raw`\boracles?:?\s+${TICK}${REF}|\bexpectations?\b[^.\n]{0,60}?\b(?:is|are|captured from)\s+(?:\`?npx\s+)?${TICK}${REF}|\bis\s+${TICK}${REF}(?:'s)?\s+output\b|\b(?:both )?oracles agree\b|\bevery other expectation is ${REF}`,

  // "restoring lessc 4.x", "the way Less 4.x expands", "the Less 4.x expanded form", "This mirrors less.js", "and so does Less 5", …
  String.raw`\brestor(?:e|es|ing|ed)\s+(?:the\s+)?${TICK}${REF}|\bthe way\s+${TICK}${REF}\b[^\n]{0,60}?\b(?:does|writes|expands|derives)\b|(?<!\bis the )\b${REF}\s+expanded form\b|\band\s+${REF}\s+writes it\b|\bthis mirrors\s+${REF}|\band so does (?:less 5|v5|jess)\b|\bbyte-for-byte (?:what|as)\s+${REF}|\b${REF}\b[^.]{0,120}?\bdivergence from the oracle\b|\bmust also error\b|\berror where ${REF} errors\b|\b${REF} output oracles?\b|\b${REF} defaults:|\ba legitimate reference\b`,

  // the reference made the contract: "Matching lessc on valid input is the contract"
  String.raw`\bmatching ${REF} on\b[^.\n]{0,40}\bis the contract`
].map(source => new RegExp(source, 'gi'));
const REF_RE = new RegExp(REF, 'i');

/*
 * A block is exempt when it says, in writing, that the reference is not the
 * reason:
 *   OWNER-RULED: YYYY-MM-DD   the owner's own ruling adopted this behaviour.
 *   UNRESOLVED                no ruling yet; escalated to the owner.
 *   REFERENCE-OBSERVATION:    a measurement kept for the record, not a reason.
 */
const REFERENCE_MARKERS = /OWNER-RULED:\s*\d{4}-\d{2}-\d{2}|\bUNRESOLVED\b|REFERENCE-OBSERVATION:/;

/* A sentence that disclaims the reference, or is about speed/`loose` mode (V18) or the legacy plugin ABI (A12). */
const REFERENCE_DISCLAIM = /observation only|for the record|not (?:an? )?authority|is not intent|not as a ruling|agrees with neither|matches neither|\bloose\b|\b(?:a|jess|real) (?:bug|gap)\b|→ jess bug|is a bug|perf\b|speed|\blegacy (?:@?plugin|ABI)\b|\bterminology\b|\bjustified as\b|\bexcept where (?:v5|less 5|jess)\b/i;
const REFERENCE_SCAN_ROOTS = ['docs', 'packages', '.cursor/rules', '.cursor/agents', 'CLAUDE.md', 'AGENTS.md'];
const REFERENCE_SKIP = [
  /(^|\/)archive\//, // frozen history
  /^packages\/syntax\/less\/jess-plugin-less-compat\//, // the 4.x plugin API IS the contract (A9, A12, C15)
  /^packages\/jess-plugin-js\//, // legacy @plugin ABI sandbox (A12)
  /^docs\/releases\//,
  /(^|\/)(node_modules|lib|dist)\//
];
const REFERENCE_EXT = /\.(md|mdc|mdx|ts|mts|cts|mjs|js)$/;
const REFERENCE_BASELINE = 'scripts/check-guardrails.reference-baseline.json';

/*
 * The files git sees (tracked, plus untracked and not ignored): generated
 * output such as `lib/`, `*.d.ts` or `packages/jess/temp/` is never scanned, so
 * a local build cannot make the result differ from CI's.
 */
const gitFiles = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 1 << 28
}).split('\0'))];

function referenceFiles() {
  return gitFiles.filter(rel => REFERENCE_EXT.test(rel)
    && REFERENCE_SCAN_ROOTS.some(r => rel === r || rel.startsWith(`${r}/`))
    && !REFERENCE_SKIP.some(re => re.test(rel))
    && existsSync(join(root, rel)));
}

/* Markdown: paragraph / list item / table row. Code: one comment block, or one test-title line. */
function referenceBlocks(rel, lines) {
  const markdown = /\.(md|mdc|mdx)$/.test(rel);
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      out.push(cur);
    }
    cur = null;
  };
  lines.forEach((line, i) => {
    let text;
    if (markdown) {
      const tableRow = /^\s*\|/.test(line);
      if (line.trim() === '' || tableRow || /^\s*(?:[-*]|\d+\.)\s/.test(line)) {
        flush();
      }
      if (line.trim() === '') {
        return;
      }
      if (tableRow) {
        out.push([{ i, text: line }]);
        return;
      }
      text = line;
    } else {
      if (/\b(?:it|test|describe)(?:\.\w+)?\(\s*['"`]/.test(line)) {
        flush();
        out.push([{ i, text: line }]);
        return;
      }
      const code = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
      if (!/^\s*(?:\/\*+|\*|\/\/)/.test(line) && !/\/\*|\/\//.test(code)) {
        flush();
        return;
      }
      text = line.replace(/^\s*(?:\/\*+|\*\/?|\/\/)\s?/, '');
    }
    cur ??= [];
    cur.push({ i, text });
  });
  flush();
  return out;
}

/* A short quoted phrase quotes the forbidden wording ("Matches less.js" is never a justification). */
function insideShortQuote(s, idx) {
  const before = s.slice(0, idx);
  const open = Math.max(before.lastIndexOf('"'), before.lastIndexOf('“'));
  if (open < 0 || (before.match(/["“”]/g) ?? []).length % 2 === 0) {
    return false;
  }
  const close = s.slice(idx).search(/["”]/);
  return idx - open < 40 && close >= 0 && close < 60;
}

const normalizeSentence = s => s.replace(/\s+/g, ' ').trim();

function scanReferenceReasons() {
  const hits = [];
  for (const rel of referenceFiles()) {
    const lines = readFileSync(join(root, rel), 'utf8').split('\n');
    for (const parts of referenceBlocks(rel, lines)) {
      let text = '';
      const offsets = [];
      for (const p of parts) {
        offsets.push([text.length, p.i]);
        text += `${p.text} `;
      }
      if (REFERENCE_MARKERS.test(text)) {
        continue;
      }
      const lineAt = k => offsets.reduce((ln, [o, i]) => (o <= k ? i : ln), parts[0].i);
      const seen = new Set();
      REFERENCE_PATTERNS.forEach((re, pattern) => {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          /* In user docs, "as in Less 4.x" tells a migrating reader nothing changed: continuity, not a reason. */
          if (insideShortQuote(text, m.index) || (pattern === 0 && rel.startsWith('packages/docs/docs-content/'))) {
            continue;
          }
          const start = text.lastIndexOf('. ', m.index) + 1;
          const endRaw = text.indexOf('. ', m.index + m[0].length);
          const sentence = normalizeSentence(text.slice(start, endRaw < 0 ? text.length : endRaw + 1));
          if (REFERENCE_DISCLAIM.test(sentence) || seen.has(sentence)) {
            continue;
          }
          seen.add(sentence);
          const line = lineAt(m.index + Math.max(0, m[0].search(REF_RE))) + 1;
          hits.push({ file: rel, line, pattern, match: m[0], sentence });
        }
      });
    }
  }
  return hits;
}

const referenceHits = scanReferenceReasons();
const listReferenceReasons = process.argv.includes('--list-reference-reasons');
const pruneBaselines = process.argv.includes('--prune-baselines');

/*
 * A shrink-only baseline: file → entries (a multiset; line numbers are
 * deliberately not part of the key). Returns the hits it does not hold and the
 * entries no hit matched. `--prune-baselines` drops the stale entries; nothing
 * ever adds one.
 */
function ratchet(hits, baselineRel) {
  const path = join(root, baselineRel);
  const baseline = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const remaining = new Map(Object.entries(baseline).map(([file, entries]) => [file, [...entries]]));
  const fresh = [];
  for (const hit of hits) {
    const left = remaining.get(hit.file);
    const at = left ? left.indexOf(hit.sentence) : -1;
    if (at >= 0) {
      left.splice(at, 1);
    } else {
      fresh.push(hit);
    }
  }
  const stale = [...remaining].flatMap(([file, entries]) => entries.map(sentence => ({ file, sentence })));
  if (!pruneBaselines || stale.length === 0) {
    return { fresh, stale };
  }
  const pruned = {};
  for (const [file, entries] of Object.entries(baseline)) {
    const dropped = [...(remaining.get(file) ?? [])];
    const out = entries.filter((e) => {
      const at = dropped.indexOf(e);
      if (at < 0) {
        return true;
      }
      dropped.splice(at, 1);
      return false;
    });
    if (out.length > 0) {
      pruned[file] = out;
    }
  }
  writeFileSync(path, `${JSON.stringify(pruned, null, 2)}\n`);
  console.log(`Pruned ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'} from ${baselineRel}.`);
  return { fresh, stale: [] };
}

const reference = ratchet(referenceHits, REFERENCE_BASELINE);
const newReferenceHits = reference.fresh;
const staleBaseline = reference.stale;

const REFERENCE_REASON_MESSAGE = [
  '  Less 4.x / lessc behaviour is not a reason. Less v5 is a breaking release — cite the',
  '  ledger row, CSS spec section, or dated owner ruling that makes this intentional, or mark',
  '  it UNRESOLVED and escalate to the owner.',
  '',
  '  Never "fix" jess, a test, a golden or a doc to match lessc. When lessc differs from a',
  '  ledger row or owner ruling, the ruling wins (docs/architecture/core/DESIGN-DECISIONS.md',
  '  E1/E5/E6). Contrast is fine: "Less 4.x wrote X; Less 5 writes Y because <row/spec>".',
  '',
  '  Block markers (same paragraph, comment block, table row or test title):',
  '    OWNER-RULED: YYYY-MM-DD   the owner ruled this behaviour. Date required.',
  '    UNRESOLVED                no ruling yet; escalated to the owner.',
  '    REFERENCE-OBSERVATION:    a measurement kept for the record, not a reason.'
];

if (newReferenceHits.length > 0) {
  failures.push(
    [
      `${newReferenceHits.length} new line(s) use Less 4.x / lessc behaviour as a reason.`,
      '',
      ...REFERENCE_REASON_MESSAGE,
      '',
      ...newReferenceHits.map(h => `    ${h.file}:${h.line}  "${h.match}"\n      ${h.sentence.slice(0, 240)}`)
    ].join('\n')
  );
}

if (staleBaseline.length > 0) {
  failures.push(
    [
      `${staleBaseline.length} baselined reference-reason entr${staleBaseline.length === 1 ? 'y no longer occurs' : 'ies no longer occur'}.`,
      '',
      `  Good — remove ${staleBaseline.length === 1 ? 'it' : 'them'} from ${REFERENCE_BASELINE} so the baseline only`,
      '  shrinks: `node scripts/check-guardrails.mjs --prune-baselines`.',
      '  (A reworded sentence that still uses lessc as a reason shows up above as new.)',
      '',
      ...staleBaseline.map(s => `    ${s.file}\n      ${s.sentence.slice(0, 240)}`)
    ].join('\n')
  );
}

/* ------------------------------------------------------------------ *
 * Assertion 4 — owner rulings change only with the owner's approval.
 * ------------------------------------------------------------------ */

/*
 * The ledger row and its conformance test are the ruling. An agent that made
 * the code match lessc and then "corrected" the row, the test or the golden to
 * match the code has reversed an owner ruling silently. A change to either now
 * fails until the lock changes with it, and the lock diff names the ruling.
 * Detection of owner-ruled rows and the hashing rules: scripts/rulings-lock.mjs.
 */
const rulings = compareRulingsLock();
if (!rulings.lock) {
  failures.push(`${LOCK} is MISSING. Restore it from git history; regenerating it is an owner-approved act.`);
} else if (rulings.ledger.length + rulings.tests.length > 0) {
  const ids = [...new Set([...rulings.ledger, ...rulings.tests].map(c => c.id))];
  failures.push(
    [
      `This change edits OWNER RULING ${ids.join(', ')}. Owner rulings change only with the owner's explicit approval.`,
      '',
      ...rulings.ledger.map(c => `    ${c.id}: ${LEDGER} row ${c.what}`),
      ...rulings.tests.map(c => `    ${c.id}: ${RULING_TESTS} test ${c.what}${c.key === c.id ? '' : `\n      ${c.key}`}`),
      '',
      '  When code disagrees with an owner ruling, the CODE is the defect: fix the code, or',
      '  escalate to the owner. Never edit the ruling, its conformance test, the golden or',
      '  the docs to match the code or lessc. Less 4.x output is never a reason.',
      '',
      '  Implementation notes do not go in an owner row: put them in',
      '  docs/architecture/core/DESIGN-DECISIONS-NOTES.md under the row id.',
      '',
      '  Only if the owner explicitly approved THIS change: run `pnpm rulings:lock` (it prints',
      `  which rulings changed) and commit ${LOCK} with it.`
    ].join('\n')
  );
}

/* ------------------------------------------------------------------ *
 * Assertion 5 — well-formed input never stops the pipeline (P45).
 * ------------------------------------------------------------------ */

/*
 * Ledger P45 (owner 2026-10-09): every parser accepts every well-formed shape;
 * what a dialect rejects is a diagnostic, and parsing continues. A grammar that
 * stops recognizing a shape is caught by the conformance tests and the review
 * (GRAMMAR-REVIEW-STANDARD item 17), not here. What this catches cheaply is the
 * other route: a new author-facing `throw` in a parser package. Invariant
 * throws (`TypeError`, `Error`, `RangeError`: "the grammar produced an
 * impossible shape") are not counted. The baselined sites may only shrink.
 */
const PARSER_SOURCE = /^packages\/(?:syntax\/[^/]+\/[^/]+-parser|parser-shared)\/src\/.+(?<!\.d)\.ts$/;
const THROW_SITE = /\bthrow\s+(?:new\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const INVARIANT_THROW = new Set(['TypeError', 'Error', 'RangeError']);
const NOT_WELL_FORMED = /NOT-WELL-FORMED:/;
const PARSER_REJECTION_BASELINE = 'scripts/check-guardrails.parser-rejections.json';

const rejectionHits = [];
for (const rel of gitFiles.filter(f => PARSER_SOURCE.test(f) && existsSync(join(root, f)))) {
  const lines = readFileSync(join(root, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = THROW_SITE.exec(line);
    if (!m || INVARIANT_THROW.has(m[1]) || /^\s*(?:\*|\/\/)/.test(line)
      || NOT_WELL_FORMED.test(line) || NOT_WELL_FORMED.test(lines[i - 1] ?? '')) {
      return;
    }
    rejectionHits.push({ file: rel, line: i + 1, sentence: normalizeSentence(line) });
  });
}
const rejections = ratchet(rejectionHits, PARSER_REJECTION_BASELINE);

if (rejections.fresh.length > 0) {
  failures.push(
    [
      `${rejections.fresh.length} new author-facing throw(s) in a parser package.`,
      '',
      '  Ledger P45 (owner 2026-10-09): every parser accepts every WELL-FORMED shape (CSS',
      '  Syntax 3: it tokenizes, blocks and functions balance, structurally valid position).',
      '  What a dialect rejects or cannot give meaning to is a DIAGNOSTIC at its span, and',
      '  parsing and evaluation continue. A hard stop on well-formed input is a defect.',
      '',
      '  Report a diagnostic instead of throwing. Only if the input this refuses is not',
      '  well-formed at all, say why on the throw line or the line above:',
      '    // NOT-WELL-FORMED: <why, per CSS Syntax 3>',
      '',
      ...rejections.fresh.map(h => `    ${h.file}:${h.line}\n      ${h.sentence}`)
    ].join('\n')
  );
}

if (rejections.stale.length > 0) {
  failures.push(
    [
      `${rejections.stale.length} baselined parser throw site(s) no longer occur.`,
      '',
      `  Good — remove ${rejections.stale.length === 1 ? 'it' : 'them'} from ${PARSER_REJECTION_BASELINE} so the count only shrinks:`,
      '  `node scripts/check-guardrails.mjs --prune-baselines`.',
      '',
      ...rejections.stale.map(s => `    ${s.file}\n      ${s.sentence}`)
    ].join('\n')
  );
}

/* ------------------------------------------------------------------ */

/* exitCode, not exit(): a piped stdout/stderr is asynchronous on macOS and exit() truncates it. */
if (listReferenceReasons) {
  console.log(JSON.stringify(referenceHits, null, 1));
} else if (failures.length > 0) {
  console.error('\ncheck:guardrails FAILED\n');
  for (const f of failures) {
    console.error(f);
    console.error('');
  }
  console.error(
    'Rules: AGENTS.md, first two sections; docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md, "An agent\n'
    + 'may not redefine, narrow, or close an owner requirement". Requirements: docs/OWNER-REQUIREMENTS.md.\n'
    + 'Owner rulings: docs/architecture/core/DESIGN-DECISIONS.md, locked in owner-rulings.lock.json.\n'
  );
  process.exitCode = 1;
} else {
  console.log(
    `check:guardrails OK — ${OWNER_REQUIREMENTS} matches its recorded hash; no unattributed closure directives; `
    + `no new Less 4.x-as-reason lines (${referenceHits.length} baselined); `
    + `${Object.keys(rulings.current.ledger).length} owner-ruled rows and ${Object.keys(rulings.current.tests).length - 1} ruling tests match ${LOCK}; `
    + `no new parser throw (${rejectionHits.length} baselined).`
  );
}
