/**
 * Robust first-set-guard diff, AST instance vs CST instance, per rule.
 *
 * NOTE the trap that invalidates a naive `const _ngc\d+ =` count: rolldown
 * inlines single-use consts, so a guard parseman emitted as
 *     const _ngc7 = _pos < input.length ? (input.codePointAt(_pos) ?? -1) : -1
 *     if (!(_ngc7 === 38)) ...
 * ships as
 *     if (!((_pos < input.length ? input.codePointAt(_pos) ?? -1 : -1) === 38)) ...
 * with no binding at all. Both spellings must be counted.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
const FILES = [
  ['css', 'packages/syntax/css/css-parser/lib/grammar.js', 'cssGrammar', 'cssCstGrammar'],
  ['less', 'packages/syntax/less/less-parser/lib/grammar2.js', 'lessGrammar', 'lessCstGrammar'],
  ['scss', 'packages/syntax/scss/scss-parser/lib/grammar.js', 'scssGrammar', 'scssCstGrammar'],
  ['jess', 'packages/syntax/jess/jess-parser/lib/grammar.js', 'jessGrammar', 'jessCstGrammar']
]
const INSTANCE_RE = /^const ((?:css|less|scss|jess)(?:Line|Cst|DiagnosticCst)?Grammar) = /
const RULE_RE = /^\tfunction (_r_[A-Za-z0-9_$]+)\(/

const NAMED_DECL = /\bconst _ngc\d+ = /g
const INLINE_GUARD = /if \(!\(.*input\.codePointAt\(/

function guardsByRule(lines, from, to) {
  const counts = new Map()
  let rule = '(top)'
  for (let i = from; i < to; i++) {
    const l = lines[i]
    const m = RULE_RE.exec(l)
    if (m) rule = m[1]
    let n = (l.match(NAMED_DECL) ?? []).length
    if (INLINE_GUARD.test(l)) n++
    if (n) counts.set(rule, (counts.get(rule) ?? 0) + n)
  }
  return counts
}

for (const [dialect, rel, astName, cstName] of FILES) {
  const lines = readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8').split('\n')
  const bounds = []
  lines.forEach((l, i) => {
    const m = INSTANCE_RE.exec(l)
    if (m) bounds.push({ name: m[1], start: i })
  })
  bounds.forEach((b, i) => { b.end = i + 1 < bounds.length ? bounds[i + 1].start : lines.length })
  const ast = bounds.find((b) => b.name === astName)
  const cst = bounds.find((b) => b.name === cstName)
  const a = guardsByRule(lines, ast.start, ast.end)
  const c = guardsByRule(lines, cst.start, cst.end)

  const names = new Set([...a.keys(), ...c.keys()])
  const diffs = []
  for (const n of names) {
    const av = a.get(n) ?? 0
    const cv = c.get(n) ?? 0
    if (av !== cv) diffs.push({ rule: n, ast: av, cst: cv, delta: av - cv })
  }
  const sum = (m) => [...m.values()].reduce((x, y) => x + y, 0)
  console.log(`\n### ${dialect}: AST=${sum(a)}  CST=${sum(c)}  (delta ${sum(a) - sum(c)})`)
  if (diffs.length === 0) console.log('    no per-rule difference')
  else console.table(diffs.sort((x, y) => x.delta - y.delta))
}
