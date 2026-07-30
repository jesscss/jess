/**
 * Count node-level first-set PRE-GUARDS per grammar instance in the shipped
 * artifacts, by *declaration* rather than by comparison.
 *
 * parseman 0.43.0 dist/index.js:8985-8993 emits the guard as exactly two lines:
 *   const _ngcN = <pos> < input.length ? (input.codePointAt(<pos>) ?? -1) : -1
 *   if (!(<firstSetCond on _ngcN>)) <fail>
 * so `const _ngcN =` is one guard, once. Counting `_ngcN ===` instead counts
 * the ranges inside a single guard and inflates the total.
 *
 * The guard is emitted only when `(capturesChildren || structural)`; CST mode
 * forces capturesChildren true, so AST-vs-CST delta == guards suppressed by a
 * confirmed zero-arity reducer.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
const FILES = [
  ['css', 'packages/syntax/css/css-parser/lib/grammar.js'],
  ['less', 'packages/syntax/less/less-parser/lib/grammar2.js'],
  ['scss', 'packages/syntax/scss/scss-parser/lib/grammar.js'],
  ['jess', 'packages/syntax/jess/jess-parser/lib/grammar.js']
]
const INSTANCE_RE = /^const ((?:css|less|scss|jess)(?:Line|Cst|DiagnosticCst)?Grammar) = /
const DECL = /\bconst _ngc\d+ = /g
const CMP = /_ngc\d+ ===/g

for (const [dialect, rel] of FILES) {
  const lines = readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8').split('\n')
  const bounds = []
  lines.forEach((l, i) => {
    const m = INSTANCE_RE.exec(l)
    if (m) bounds.push({ name: m[1], start: i })
  })
  bounds.forEach((b, i) => { b.end = i + 1 < bounds.length ? bounds[i + 1].start : lines.length })

  const rows = bounds.map((b) => {
    let decls = 0
    let cmps = 0
    for (let i = b.start; i < b.end; i++) {
      decls += (lines[i].match(DECL) ?? []).length
      cmps += (lines[i].match(CMP) ?? []).length
    }
    return { instance: b.name, guardDecls: decls, ngcComparisons: cmps }
  })
  console.log(`\n### ${dialect}`)
  console.table(rows)
}
