/*
 * Does a crossed closure get REPORTED via errors even when consumption looks
 * complete? balanced()'s close is wrapped in expect(), and expect() recovers
 * instead of failing -- so consumption alone cannot distinguish "accepted"
 * from "accepted with a recovered error".
 */
import { balanced, rules, run, compose } from 'parseman';

function probe(entry, src) {
  try {
    const r = run(entry, src);
    if (!r || r.ok === false) {
      return 'REJECTED (ok=false)';
    }
    const consumed = r.unconsumedFrom ?? r.span?.end ?? 0;
    const errs = (r.errors ?? []).length;
    const exp = (r.expected ?? []).length;
    return `ok consumed=${consumed}/${src.length} errors=${errs} expected=${exp} value=${JSON.stringify(r.value)}`;
  } catch (e) {
    return `THROW ${e.message.slice(0, 60)}`;
  }
}

const CASES = ['(a)', '([a])', '([a)]', '({a)}', '([a}])'];

const cfgs = {
  bare: compose([rules(g => ({ E: balanced('(', ')') }))]).E,
  'literal-skips': compose([rules(g => ({
    E: balanced('(', ')', { skip: [balanced('[', ']'), balanced('{', '}')] })
  }))]).E,
  'mutual-g-skips': compose([rules(g => ({
    BalParen: balanced('(', ')', { skip: [g.BalBracket, g.BalBrace] }),
    BalBracket: balanced('[', ']', { skip: [g.BalParen, g.BalBrace] }),
    BalBrace: balanced('{', '}', { skip: [g.BalParen, g.BalBracket] }),
    E: g.BalParen
  }))]).E
};

for (const [name, entry] of Object.entries(cfgs)) {
  console.log(`\n--- ${name} ---`);
  for (const s of CASES) {
    console.log(`  ${JSON.stringify(s).padEnd(9)} -> ${probe(entry, s)}`);
  }
}
