// Which combinators contribute ZERO children, and which contribute a slot
// holding a non-structural value? Measured against node() capture.
import { node, parser, sequence, literal, not, peek, gate, withCtx, regex, token, expect, trivia, skip, parse } from 'parseman'

const A = token(regex(/a/))
const M = literal('<')
const N = literal('>')

function kids(label, X, input) {
  const root = node('P', sequence(M, X, N), (c) => c.slice())
  const p = parser({ trivia: null }, root)
  const r = p.parse(input)
  if (!r.ok) return `${label}: FAIL`
  const c = r.value.children ?? r.value
  return `${label.padEnd(46)} n=${c.length}  ${JSON.stringify(c.map((v) => (v === null ? 'null' : v === undefined ? 'undefined' : (v && v._tag) ? `${v._tag}(${JSON.stringify(v.value ?? '')})` : typeof v)))}`
}

console.log('Baseline: <> with NOTHING between the markers')
console.log(' ', kids('sequence(M, N) only', literal(''), '<>'))
console.log('\nZero-contribution candidates (compare n against the baseline of 2):')
console.log(' ', kids("not(literal('z'))", not(literal('z')), '<>'))
console.log(' ', kids("peek(literal('>'))", peek(literal('>')), '<>'))
console.log(' ', kids('gate(() => true)', gate(() => true), '<>'))
console.log(' ', kids("expect(literal('z'))  MISSING", expect(literal('z')), '<>'))
console.log('\nPass-through wrappers (compare against sequence(M, A, N) = 3):')
console.log(' ', kids('bare A', A, '<a>'))
console.log(' ', kids('withCtx({m:1}, A)', withCtx({ m: 1 }, A), '<a>'))
console.log(' ', kids('skip(A, regex(/\\s*/))', skip(A, regex(/[ ]*/)), '<a>'))

console.log('\nSame constructs as a raw parse() VALUE (not node children):')
for (const [label, X, input] of [
  ["not(literal('z'))", not(literal('z')), 'a'],
  ["peek(literal('a'))", peek(literal('a')), 'a'],
  ['gate(() => true)', gate(() => true), 'a'],
  ["expect(literal('z'))", expect(literal('z')), 'a'],
]) {
  const r = parse(sequence(X, A), input, { recover: true })
  console.log(`  ${label.padEnd(26)} value=${JSON.stringify(r.ok ? r.value.map((v) => (v && v._tag) ? v._tag : v) : 'FAIL')}`)
}
