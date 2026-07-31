import { balanced, rules, run, compose } from 'parseman';

// A "full match" = ok AND every byte consumed. `run` does NOT require this.
function full(entry, src) {
  try {
    const r = run(entry, src);
    if (!r || r.ok === false) {
      return { ok: false, why: 'no-match' };
    }
    const consumed = r.unconsumedFrom ?? (r.span ? r.span.end : 0);
    return { ok: consumed === src.length, why: `consumed=${consumed}/${src.length} value=${JSON.stringify(r.value)}` };
  } catch (e) {
    return { ok: false, why: `THROW ${e.message.slice(0, 70)}` };
  }
}

const cases = [
  ['(a)', true],
  ['([a])', true],
  ['({a})', true],
  ['([{a}])', true],
  ['((a))', true],
  ['([a)]', false],
  ['({a)}', false],
  ['([a}])', false]
];

function suite(name, entry) {
  console.log(`\n--- ${name} ---`);
  let bad = 0;
  for (const [src, expected] of cases) {
    const r = full(entry, src);
    const verdict = r.ok === expected ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') {
      bad++;
    }
    console.log(`${verdict}  ${JSON.stringify(src).padEnd(10)} want=${String(expected).padEnd(5)} got=${String(r.ok).padEnd(5)} ${r.why}`);
  }
  console.log(`${name}: ${bad} failing`);
}

suite('bare balanced, no skips', compose([rules(g => ({ E: balanced('(', ')') }))]).E);

suite('literal nested skips (one level)', compose([rules(g => ({
  E: balanced('(', ')', { skip: [balanced('[', ']'), balanced('{', '}')] })
}))]).E);

suite('mutually recursive g. skips', compose([rules(g => ({
  BalParen: balanced('(', ')', { skip: [g.BalBracket, g.BalBrace] }),
  BalBracket: balanced('[', ']', { skip: [g.BalParen, g.BalBrace] }),
  BalBrace: balanced('{', '}', { skip: [g.BalParen, g.BalBracket] }),
  E: g.BalParen
}))]).E);
