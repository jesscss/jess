/**
 * Adjudication instrument: count macro-emitted `_ctx.state` clone sites per
 * grammar instance in the SHIPPED artifacts. Only the artifact ships, so this
 * counts the artifact and nothing else.
 *
 * Two emission forms exist (parseman 0.43.0 dist/index.js:9025 and :9028):
 *   structural  : `const _nstN = _capM && _ctx.state !== undefined ? Object.assign({}, _ctx.state) : undefined`
 *   clonesState : `const _nstN = !(_recM || _capK) && _ctx.state !== undefined ? Object.assign({}, _ctx.state) : undefined`
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

const CLONE = 'Object.assign({}, _ctx.state)'
const STRUCTURAL = /_cap\d+ && _ctx\.state !== void 0 \? Object\.assign\(\{\}, _ctx\.state\)/
const CLONES_STATE = /!\(_rec\d+ \|\| _cap\d+\) && _ctx\.state !== void 0 \? Object\.assign\(\{\}, _ctx\.state\)/
const INSTANCE_RE = /^const ((?:css|less|scss|jess)(?:Line|Cst|DiagnosticCst)?Grammar) = /

const grand = []
for (const [dialect, rel] of FILES) {
  const lines = readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8').split('\n')

  const bounds = []
  lines.forEach((l, i) => {
    const m = INSTANCE_RE.exec(l)
    if (m) bounds.push({ name: m[1], start: i })
  })
  bounds.forEach((b, i) => {
    b.end = i + 1 < bounds.length ? bounds[i + 1].start : lines.length
  })

  const rows = []
  let cursor = 0
  const segments = [
    { name: '(preamble)', start: 0, end: bounds.length ? bounds[0].start : lines.length },
    ...bounds
  ]
  for (const seg of segments) {
    let clone = 0
    let structural = 0
    let clonesState = 0
    for (let i = seg.start; i < seg.end; i++) {
      const l = lines[i]
      if (!l.includes(CLONE)) continue
      clone++
      if (STRUCTURAL.test(l)) structural++
      else if (CLONES_STATE.test(l)) clonesState++
    }
    rows.push({ instance: seg.name, lines: seg.end - seg.start, clone, structural, clonesState })
    cursor = seg.end
  }
  const total = rows.reduce((a, r) => a + r.clone, 0)
  grand.push({ dialect, total })
  console.log(`\n### ${dialect}  (${rel})  ${lines.length} lines`)
  console.table(rows)
  console.log(`TOTAL clone sites: ${total}`)
}
console.log('\n### grand total')
console.table(grand)
