/**
 * For every macro-emitted `_ctx.state` clone site in the AST instance of each
 * shipped artifact, recover the build-function SOURCE that parseman's
 * `confirmedBuildArity` (parseman dist/index.js:3143) actually inspected, and
 * re-run that exact predicate on it.
 *
 * The build sources are emitted verbatim into the artifact as
 * `const <ns>__build = [ ...srcs ]`, which is the same text as `def.buildSrc`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)

const FILES = [
  ['css', 'packages/syntax/css/css-parser/lib/grammar.js', 'cssGrammar'],
  ['less', 'packages/syntax/less/less-parser/lib/grammar2.js', 'lessGrammar'],
  ['scss', 'packages/syntax/scss/scss-parser/lib/grammar.js', 'scssGrammar'],
  ['jess', 'packages/syntax/jess/jess-parser/lib/grammar.js', 'jessGrammar']
]

// Verbatim copies from parseman 0.43.0 dist/index.js:3138-3156
const PARAM_LIST_RE =
  /^(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/
const CONFIRMABLE_PARAM_RE = /^[A-Za-z_$][\w$]*\s*\??\s*(?::[^,=]+)?$/
function confirmedBuildArity(src) {
  const s = src.trim()
  const m = PARAM_LIST_RE.exec(s)
  if (!m) return null
  if (m[3] !== undefined) return 1
  const inner = (m[1] ?? m[2] ?? '').trim()
  if (inner === '') return 0
  const parts = inner.split(',')
  for (const part of parts) if (!CONFIRMABLE_PARAM_RE.test(part.trim())) return null
  if (/\barguments\b/.test(s)) return null
  return parts.length
}

/** Split a bracketed array literal body into top-level elements. */
function splitTopLevel(body) {
  const out = []
  let depth = 0
  let start = 0
  let str = null
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (str) {
      if (c === '\\') i++
      else if (c === str) str = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { str = c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1 }
  }
  out.push(body.slice(start))
  return out
}

/** Extract `const <ns>__build = [...]` arrays keyed by ns. */
function buildArrays(src) {
  const map = new Map()
  const re = /const (\w+__build) = \[/g
  let m
  while ((m = re.exec(src))) {
    let i = re.lastIndex
    let depth = 1
    let str = null
    const start = i
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (str) { if (c === '\\') i++; else if (c === str) str = null; continue }
      if (c === '"' || c === "'" || c === '`') { str = c; continue }
      if (c === '[' || c === '(' || c === '{') depth++
      else if (c === ']' || c === ')' || c === '}') depth--
    }
    map.set(m[1], splitTopLevel(src.slice(start, i - 1)).map((s) => s.trim()))
  }
  return map
}

for (const [dialect, rel, astName] of FILES) {
  const full = readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8')
  const lines = full.split('\n')
  const starts = []
  lines.forEach((l, i) => {
    const m = /^const ((?:css|less|scss|jess)(?:Line|Cst|DiagnosticCst)?Grammar) = /.exec(l)
    if (m) starts.push({ name: m[1], line: i })
  })
  const idx = starts.findIndex((s) => s.name === astName)
  const from = starts[idx].line
  const to = idx + 1 < starts.length ? starts[idx + 1].line : lines.length
  const segment = lines.slice(from, to).join('\n')
  const builds = buildArrays(segment)

  const segLines = segment.split('\n')
  const tally = new Map()
  let unresolved = 0
  let sites = 0
  for (let i = 0; i < segLines.length; i++) {
    if (!segLines[i].includes('Object.assign({}, _ctx.state)')) continue
    sites++
    // The build call is on one of the next few lines: `_<ns>__build[N](`
    let ref = null
    for (let j = i; j < Math.min(i + 40, segLines.length); j++) {
      const m = /(\w+__build)\[(\d+)\]\(/.exec(segLines[j])
      if (m) { ref = m; break }
    }
    if (!ref) {
      unresolved++
      if (process.env.PM_DEBUG) console.log(`      ?? no build ref at seg line ${i + 1}`)
      continue
    }
    const arr = builds.get(ref[1])
    const src = arr?.[Number(ref[2])]
    if (src === undefined) {
      unresolved++
      if (process.env.PM_DEBUG) {
        console.log(`      ?? ${ref[1]}[${ref[2]}] len=${arr?.length} at seg line ${i + 1}`)
      }
      continue
    }
    const arity = confirmedBuildArity(src)
    const head = src.split('\n')[0].slice(0, 90)
    const key = `${arity === null ? 'FAIL-OPEN(null)' : `arity=${arity}`}\t${head}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }

  let failOpen = 0
  let real = 0
  for (const [k, n] of tally) (k.startsWith('FAIL-OPEN') ? (failOpen += n) : (real += n))
  console.log(`\n### ${dialect} / ${astName}: ${sites} clone sites (unresolved refs: ${unresolved})`)
  console.log(`    fail-open (arity null): ${failOpen}   genuine arity>=6: ${real}`)
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}  ${k}`)
  }
}
