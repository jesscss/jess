/*
 * Diagnostic quality: incumbent vs a tier-2 validator over a captured span.
 *
 * The tier-2 validator here is ~40 lines of plain TypeScript-shaped JS with one
 * delimiter stack. It adds ZERO combinator call sites, so it is free against
 * the artifact-size rank key (GRAMMAR-SIZE-FACTS 2.1: cost is per call site).
 *
 * It is deliberately NOT wired into the grammar: this measures what diagnostics
 * are RECOVERABLE from a prelude span, which is the claim under test.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('../lib/index.cjs');

/* ---- tier 2: validate one captured prelude span ------------------------- */

const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = { ')': '(', ']': '[', '}': '{' };

/*
 * `base` is the prelude span's absolute start, so every reported offset is an
 * absolute source offset -- the span carries enough to locate the fault.
 */
function validatePrelude(text, base) {
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"' || c === '\'') {
      const quote = c;
      const start = i;
      i++;
      while (i < text.length && text[i] !== quote) {
        i += text[i] === '\\' ? 2 : 1;
      }
      if (i >= text.length) {
        return { code: 'unterminated-string', offset: base + start, detail: `unterminated ${quote === '"' ? 'double' : 'single'}-quoted string, opened ${start} chars into the prelude` };
      }
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        return { code: 'unterminated-comment', offset: base + i, detail: `unterminated comment, opened ${i} chars into the prelude` };
      }
      i = end + 2;
      continue;
    }
    if (OPENERS[c]) {
      stack.push({ ch: c, at: i });
      i++;
      continue;
    }
    if (CLOSERS[c]) {
      const top = stack.pop();
      if (top === undefined) {
        return { code: 'unmatched-close', offset: base + i, detail: `stray '${c}' with nothing open, ${i} chars into the prelude` };
      }
      if (top.ch !== CLOSERS[c]) {
        return { code: 'crossed-close', offset: base + i, detail: `'${c}' closes '${top.ch}' opened ${top.at} chars in -- expected '${OPENERS[top.ch]}'` };
      }
      i++;
      continue;
    }
    i++;
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return { code: 'unclosed-delimiter', offset: base + top.at, detail: `unclosed '${top.ch}', opened ${top.at} chars into the prelude` };
  }
  return null;
}

/*
 * Stand-in for the loose tier's capture: the prelude is the run between the
 * at-keyword and the block/statement sentinel. The real one is a parseman
 * scanTo; this only needs to produce the same span for the comparison.
 */
function capturePrelude(src) {
  const m = /^\s*@[-\w]+/.exec(src);
  if (!m) {
    return null;
  }
  const base = m[0].length;
  let depth = 0;
  for (let i = base; i < src.length; i++) {
    const c = src[i];
    if (OPENERS[c] && c !== '{') {
      depth++;
    } else if (CLOSERS[c] && c !== '}') {
      depth--;
    } else if ((c === '{' || c === ';') && depth === 0) {
      return { text: src.slice(base, i), base };
    }
  }
  return { text: src.slice(base), base };
}

/* ---- comparison --------------------------------------------------------- */

const CASES = [
  ['unclosed paren, unknown at-rule', '@whatever (foo { color: red }'],
  ['unclosed paren, @media', '@media (min-width: 5px { color: red }'],
  ['unclosed paren, @supports', '@supports (display: grid { a { b: c } }'],
  ['crossed closure, @media', '@media ([min-width: 5px) ] { a { b: c } }'],
  ['unterminated string, @media', '@media (min-width: "5px) { a { b: c } }'],
  ['well-formed control, @media', '@media (min-width: 5px) { a { b: c } }']
];

for (const [label, src] of CASES) {
  let incumbent;
  try {
    parse(src);
    incumbent = 'ACCEPTED (no diagnostic at all)';
  } catch (e) {
    const pos = e.line === undefined ? `offset ${e.offset}` : `${e.line}:${e.column}`;
    const exp = (e.expected ?? []).length ? ` expected=[${e.expected.join(', ')}]` : ' expected=[]';
    incumbent = `${e.message} (${pos})${exp}`;
  }

  const cap = capturePrelude(src);
  const v = cap ? validatePrelude(cap.text, cap.base) : null;
  const tier2 = v === null ? 'no structural fault found' : `${v.code} at offset ${v.offset}: ${v.detail}`;

  console.log(`\n== ${label}`);
  console.log(`   src      ${JSON.stringify(src)}`);
  console.log(`   incumbent ${incumbent}`);
  console.log(`   tier 2    ${tier2}`);
}
