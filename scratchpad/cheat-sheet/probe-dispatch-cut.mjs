// Does dispatch() COMMIT, and does attempt() neutralise that commit?
// This decides whether `attempt` is a real rollback guarantee or only a
// rollback for UNCOMMITTED failures.
import {
  dispatch, when, otherwise, routed, attempt, choice, optional, many, literal,
  sequence, token, regex, noTrivia, parse, node, run,
} from 'parseman'

const opener = token(noTrivia(sequence(regex(/[a-z]+/), optional(literal('(')))))
// A dispatch whose selected branch then FAILS (requires ')' that is absent).
const D = dispatch(
  opener,
  when('url(', sequence(routed(), literal(')'))),
  otherwise(routed()),
)

const w = (s, n) => String(s).padEnd(n)
function fail(label, X, src) {
  const r = parse(X, src, {})
  console.log(`  ${w(label, 44)} ok=${w(r.ok, 6)} committed=${r.ok ? '-' : String(r.committed === true)}`)
  return r
}

console.log('='.repeat(84))
console.log("dispatch() IS A CUT — input \"url(\" selects the url( branch, then ')' is missing")
console.log('='.repeat(84))
fail('bare dispatch', D, 'url(')
fail('attempt(dispatch)', attempt(D), 'url(')
fail('optional(dispatch)', optional(D), 'url(')
fail('many(dispatch)', many(D), 'url(')
fail('choice(dispatch, literal("url("))', choice(D, literal('url(')), 'url(')
fail('choice(attempt(dispatch), literal("url("))', choice(attempt(D), literal('url(')), 'url(')

console.log('\n  For contrast, an UNCOMMITTED failure (plain sequence):')
const S = sequence(token(regex(/a/)), literal('b'))
fail('bare sequence', S, 'ax')
fail('attempt(sequence)', attempt(S), 'ax')
fail('optional(sequence)', optional(S), 'ax')
fail('choice(sequence, literal("a"))', choice(S, literal('a')), 'ax')

console.log('\n' + '='.repeat(84))
console.log('run() — unconsumedFrom is the REAL leftover signal')
console.log('='.repeat(84))
const Root = many(token(regex(/a/)))
for (const src of ['aaa', 'aazz', 'zzz', '!!! not a stylesheet !!!']) {
  const r = run(Root, src)
  console.log(`  ${w(JSON.stringify(src), 28)} ok=${w(r.ok, 6)} span={${r.span?.start},${r.span?.end}}` +
    ` unconsumedFrom=${w(String(r.unconsumedFrom), 6)} len=${src.length}`)
}
