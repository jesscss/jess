// Shared probe harness. Measures, for a combinator under test:
//   arity   — how many entries it contributes to an enclosing reducer's `children`
//   empty   — can it succeed consuming zero characters
//   commit  — can it fail AFTER consuming (i.e. does a call site need rollback)
import { node, parser, sequence, literal, regex } from 'parseman'

export const ws = regex(/[ \t\r\n]+/)

/**
 * Contribution arity: `node()` captures exactly the children its body contributed,
 * so wrapping X alone measures what X hands to an enclosing children array.
 */
export function arity(X, input, opts = {}) {
  const root = node('P', X, (children) => children.slice())
  const p = parser({ trivia: opts.trivia ?? null }, root)
  const r = p.parse(input)
  if (!r.ok) return { ok: false, committed: r.committed === true, reason: r.expected ?? r.message ?? '(fail)' }
  const kids = r.value?.children ?? r.value
  return {
    ok: true,
    n: Array.isArray(kids) ? kids.length : '(not-array)',
    kinds: Array.isArray(kids) ? kids.map(describe) : describe(kids),
    span: [r.span.start, r.span.end],
    consumed: r.span.end - r.span.start,
    errors: (r.errors ?? []).length,
  }
}

/** Arity in POSITION: X between two markers, so index shifting is visible. */
export function positional(X, input, opts = {}) {
  const root = node('P', sequence(literal('<'), X, literal('>')), (children) => children.slice())
  const p = parser({ trivia: opts.trivia ?? null }, root)
  const r = p.parse(input)
  if (!r.ok) return { ok: false, committed: r.committed === true }
  const kids = r.value?.children ?? r.value
  return { ok: true, n: kids.length, kinds: kids.map(describe), span: [r.span.start, r.span.end] }
}

/** Raw run of a combinator at a position, exposing ok/committed/span/errors. */
export function raw(X, input, opts = {}) {
  const p = parser({ trivia: opts.trivia ?? null, recover: opts.recover ?? true }, X)
  const r = p.parse(input)
  return {
    ok: r.ok,
    committed: r.committed === true,
    span: [r.span.start, r.span.end],
    consumed: r.span.end - r.span.start,
    zeroWidth: r.ok && r.span.end === r.span.start,
    errors: (r.errors ?? []).length,
    value: r.ok ? describe(r.value) : undefined,
    expected: r.ok ? undefined : (r.expected ?? r.message),
  }
}

export function describe(v) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `[${v.length}]`
  if (typeof v === 'object') {
    if (v._tag === 'node') return `node:${v.type}`
    if (v._tag === 'leaf') return `leaf(${JSON.stringify(v.value ?? v.text ?? '')})`
    if (v._tag === 'error') return `ERROR`
    if ('value' in v && typeof v.value !== 'object') return `{value:${JSON.stringify(v.value)}}`
    return `obj{${Object.keys(v).slice(0, 4).join(',')}}`
  }
  return JSON.stringify(v)
}

// ---- assertion plumbing -------------------------------------------------
let pass = 0
const failures = []

export function check(claim, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return true }
  failures.push({ claim, actual: a, expected: e })
  return false
}

export function report(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)
  console.log(`  passed: ${pass}   failed: ${failures.length}`)
  for (const f of failures) {
    console.log(`\n  FAIL: ${f.claim}\n    expected ${f.expected}\n    actual   ${f.actual}`)
  }
  return failures.length
}
