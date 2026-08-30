// EMPTY + COMMIT PROBE.
//   empty  — can it succeed consuming zero characters?
//   commit — can it FAIL after consuming (call site needs rollback)?
import {
  literal, regex, keywords, word, sequence, choice, many, oneOrMore, optional,
  sepBy, oneOrMoreSep, not, peek, node, transform, attempt, expect, scanTo, balanced,
  token, gate, withCtx, label, field, noTrivia, run,
} from 'parseman'
import { raw } from './harness.mjs'

const A = token(regex(/a/))
const B = token(regex(/b/))

const rows = []
function probe(name, spelling, X, emptyInput, failInput) {
  const e = raw(X, emptyInput)
  const f = failInput === undefined ? undefined : raw(X, failInput)
  rows.push({
    name, spelling,
    emptyIn: JSON.stringify(emptyInput),
    emptyOk: e.ok ? (e.zeroWidth ? 'ZERO-WIDTH OK' : `ok consumed ${e.consumed}`) : 'fail',
    errs: e.errors,
    failIn: failInput === undefined ? '-' : JSON.stringify(failInput),
    commit: f === undefined ? '-' : (f.ok ? `ok(consumed ${f.consumed}, errs ${f.errors})` : (f.committed ? 'FAILS COMMITTED' : 'fails clean')),
  })
}

probe('literal', "literal('a')", literal('a'), '', 'b')
probe('regex', 'regex(/a/)', regex(/a/), '', 'b')
probe('regex', 'regex(/a?/)  NULLABLE', regex(/a?/), '', 'b')
probe('regex', 'regex(/(?=a)/) LOOKAHEAD-ONLY', regex(/(?=a)/), 'a', 'b')
probe('keywords', "keywords(['red'])", keywords(['red']), '', 'blu')
probe('word', "word('red')", word('red'), '', 'redx')
probe('sequence', 'sequence(a,b)', sequence(A, B), '', 'ax')
probe('choice', 'choice(sequence(a,b), a)', choice(sequence(A, B), A), '', 'ax')
probe('many', 'many(a)', many(A), '', 'b')
probe('many', 'many(sequence(a,b))  body CAN commit', many(sequence(A, B)), '', 'ax')
probe('oneOrMore', 'oneOrMore(a)', oneOrMore(A), '', 'b')
probe('optional', 'optional(a)', optional(A), '', 'b')
probe('optional', 'optional(sequence(a,b)) body CAN commit', optional(sequence(A, B)), '', 'ax')
probe('sepBy', "sepBy(a, literal(','))", sepBy(A, literal(',')), '', 'b')
probe('oneOrMoreSep', "oneOrMoreSep(a, literal(','))", oneOrMoreSep(A, literal(',')), '', 'b')
probe('not', "not(literal('z'))", not(literal('z')), '', 'z')
probe('peek', "peek(literal('a'))", peek(literal('a')), 'a', 'b')
probe('attempt', 'attempt(sequence(a,b))  ROLLS BACK', attempt(sequence(A, B)), '', 'ax')
probe('expect', "expect(literal('b'))  MISSING", expect(literal('b')), '', 'zz')
probe('expect', "many(expect(literal('b'))) DANGER", many(expect(literal('b'))), '', undefined)
probe('gate', 'gate(() => true)', gate(() => true), '', undefined)
probe('gate', 'gate(() => false)', gate(() => false), '', undefined)
probe('scanTo', "scanTo(literal(')'))", scanTo(literal(')')), '', 'abc')
probe('scanTo', "scanTo(literal(')')) immediate", scanTo(literal(')')), ')', undefined)
probe('balanced', "balanced('(',')')", balanced('(', ')'), '', '(ab')
probe('node', "node('N', a)", node('N', A, (c) => c), '', 'b')
probe('transform', 'transform(a, v=>v)', transform(A, (v) => v), '', 'b')
probe('label', "label('L', a)", label('L', A), '', 'b')
probe('field', "field('f', a)", field('f', A), '', 'b')
probe('noTrivia', 'noTrivia(sequence(a,b))', noTrivia(sequence(A, B)), '', 'ax')

const w = (s, n) => String(s).padEnd(n)
console.log(w('COMBINATOR', 13) + w('SPELLING', 42) + w('ON-EMPTY-INPUT', 18) + w('errs', 5) + w('FAIL-INPUT', 12) + 'AFTER CONSUMING?')
console.log('-'.repeat(140))
for (const r of rows) {
  console.log(w(r.name, 13) + w(r.spelling, 42) + w(r.emptyOk, 18) + w(r.errs, 5) + w(r.failIn, 12) + r.commit)
}

// ---- THE run() FULL-CONSUMPTION CLAIM -----------------------------------
console.log('\n' + '='.repeat(72) + '\nrun() ON PURE GARBAGE\n' + '='.repeat(72))
const Root = many(A)
for (const src of ['', 'zzz', '!!! not a stylesheet !!!', 'aaa', 'aazz']) {
  const r = run(Root, src)
  console.log(
    `  ${JSON.stringify(src).padEnd(28)} ok=${r.ok}  span=${r.span ? `{${r.span.start},${r.span.end}}` : 'n/a'}` +
    `  source.length=${src.length}  FULLY-CONSUMED=${r.ok && r.span && r.span.end === src.length}`,
  )
}

// ---- THE balanced() CROSSED-CLOSURE CLAIM --------------------------------
console.log('\n' + '='.repeat(72) + '\nbalanced() CROSSED CLOSURES — consumption vs RECOVERY\n' + '='.repeat(72))
const bal = balanced('(', ')', { skip: [balanced('[', ']'), balanced('{', '}')] })
for (const src of ['(abc)', '(a[b]c)', '(a{b}c)', '([c}])', '(a[b)c]', '(unclosed']) {
  const r = raw(bal, src, { recover: true })
  console.log(
    `  ${JSON.stringify(src).padEnd(14)} ok=${String(r.ok).padEnd(5)} consumed=${String(r.consumed).padEnd(3)}` +
    ` errors=${r.errors}   ${r.ok && r.errors > 0 ? '<-- ACCEPTED BUT RECOVERED (a consumption-only probe cannot see this)' : ''}`,
  )
}
