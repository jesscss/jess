// ARITY PROBE — what each combinator contributes to an enclosing reducer's `children`.
// Every row printed here is a MEASUREMENT against the installed parseman.
import {
  literal, regex, keywords, word, makeWord, sequence, choice, dispatch, when, makeWhen,
  startsWith, endsWith, matches, otherwise, routed, attempt, many, oneOrMore, optional,
  sepBy, oneOrMoreSep, rules, ref, not, peek, node, transform, skip, trivia, label, field,
  token, leaf, gate, withCtx, expect, scanTo, balanced, noTrivia,
} from 'parseman'
import { arity, positional } from './harness.mjs'

const A = token(regex(/a/))
const B = token(regex(/b/))
const ident = token(regex(/[a-z][-a-z0-9]*/))

const rows = []
function row(name, spelling, input, result) {
  rows.push({ name, spelling, input, ...result })
}

// --- terminals: exactly ONE child each -----------------------------------
row('literal', "literal('a')", 'a', arity(literal('a'), 'a'))
row('regex', 'regex(/ab/)', 'ab', arity(regex(/ab/), 'ab'))
row('keywords', "keywords(['red','blue'])", 'red', arity(keywords(['red', 'blue']), 'red'))
row('word', "word('red')", 'red', arity(word('red'), 'red'))
row('makeWord', "makeWord({})('red')", 'red', arity(makeWord({})('red'), 'red'))
row('token', 'token(regex(/ab/))', 'ab', arity(token(regex(/ab/)), 'ab'))
row('leaf', 'leaf(regex(/ab/), v=>v)', 'ab', arity(leaf(regex(/ab/), (v) => v), 'ab'))
row('scanTo', "scanTo(literal(')'))", 'xyz)', arity(scanTo(literal(')')), 'xyz)'))

// --- sequence: SPREADS its terms -----------------------------------------
row('sequence', 'sequence(a,b)', 'ab', arity(sequence(A, B), 'ab'))
row('sequence', 'sequence(a,b,a)', 'aba', arity(sequence(A, B, A), 'aba'))
row('sequence', 'nested sequence(a,sequence(b,a))', 'aba', arity(sequence(A, sequence(B, A)), 'aba'))

// --- choice: contributes whatever the WINNING arm contributes ------------
row('choice', 'choice(a, sequence(b,a))', 'a', arity(choice(A, sequence(B, A)), 'a'))
row('choice', 'choice(a, sequence(b,a))', 'ba', arity(choice(A, sequence(B, A)), 'ba'))

// --- repetition: SPREADS ---------------------------------------------------
row('many', 'many(a) x0', '', arity(many(A), ''))
row('many', 'many(a) x1', 'a', arity(many(A), 'a'))
row('many', 'many(a) x3', 'aaa', arity(many(A), 'aaa'))
row('many', '<many(a)> x3', '<aaa>', positional(many(A), '<aaa>'))
row('many', '<many(a)> x0', '<>', positional(many(A), '<>'))
row('oneOrMore', 'oneOrMore(a) x3', 'aaa', arity(oneOrMore(A), 'aaa'))
row('optional', 'optional(a) present', 'a', arity(optional(A), 'a'))
row('optional', 'optional(a) absent', '', arity(optional(A), ''))
row('optional', '<optional(a)> present', '<a>', positional(optional(A), '<a>'))
row('optional', '<optional(a)> ABSENT', '<>', positional(optional(A), '<>'))
row('sepBy', "sepBy(a, literal(','))", 'a,a,a', arity(sepBy(A, literal(',')), 'a,a,a'))
row('sepBy', "sepBy(a, literal(',')) empty", '', arity(sepBy(A, literal(',')), ''))
row('oneOrMoreSep', "oneOrMoreSep(a, literal(','))", 'a,a', arity(oneOrMoreSep(A, literal(',')), 'a,a'))

// --- zero-contribution combinators ---------------------------------------
row('not', "<not(literal('z')) a>", '<a>', positional(sequence(not(literal('z')), A), '<a>'))
row('peek', "<peek(literal('a')) a>", '<a>', positional(sequence(peek(literal('a')), A), '<a>'))

// --- wrappers -------------------------------------------------------------
row('node', "node('N', sequence(a,b))", 'ab', arity(node('N', sequence(A, B), (c) => c.slice()), 'ab'))
row('transform', 'transform(sequence(a,b), fn)', 'ab', arity(transform(sequence(A, B), (v) => v), 'ab'))
row('label', "label('A', a)   // NAME FIRST", 'a', arity(label('A', A), 'a'))
row('attempt', 'attempt(sequence(a,b))', 'ab', arity(attempt(sequence(A, B)), 'ab'))
row('noTrivia', 'noTrivia(sequence(a,b))', 'ab', arity(noTrivia(sequence(A, B)), 'ab'))
row('expect', "sequence(a, expect(literal('b')))  MATCHES", 'ab', arity(sequence(A, expect(literal('b'))), 'ab'))
row('expect', "sequence(a, expect(literal('b')))  MISSING", 'a', arity(sequence(A, expect(literal('b'))), 'a'))

// --- field: named capture, does it still occupy a children slot? ----------
row('field', "sequence(a, field('x', b))", 'ab', arity(sequence(A, field('x', B)), 'ab'))

// --- dispatch / routed ----------------------------------------------------
const opener = token(noTrivia(sequence(ident, optional(literal('(')))))
const D = dispatch(
  opener,
  when('url(', node('Url', sequence(routed(), literal(')')), (c) => c.slice())),
  when(endsWith('('), node('Call', sequence(routed(), literal(')')), (c) => c.slice())),
  otherwise(node('Kw', routed(), (c) => c.slice())),
)
row('dispatch', 'dispatch -> when exact', 'url()', arity(D, 'url()'))
row('dispatch', 'dispatch -> endsWith', 'foo()', arity(D, 'foo()'))
row('dispatch', 'dispatch -> otherwise', 'red', arity(D, 'red'))
row('routed', 'routed() inside branch', 'red', arity(node('Kw', routed(), (c) => c.slice()), 'red'))

// --- balanced -------------------------------------------------------------
row('balanced', "scanTo(literal(')'), {skip:[balanced('(',')')]})", 'a(b)c)', arity(
  scanTo(literal(')'), { skip: [balanced('(', ')')] }), 'a(b)c)'))
row('balanced', "balanced('(',')')", '(ab)', arity(balanced('(', ')'), '(ab)'))

// --- print ----------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n)
console.log(w('COMBINATOR', 14) + w('SPELLING', 46) + w('INPUT', 10) + w('OK', 4) + w('#kids', 6) + 'CHILDREN')
console.log('-'.repeat(140))
for (const r of rows) {
  console.log(
    w(r.name, 14) + w(r.spelling, 46) + w(JSON.stringify(r.input), 10) +
    w(r.ok ? 'y' : 'N', 4) + w(r.ok ? r.n : '-', 6) +
    (r.ok ? JSON.stringify(r.kinds) : `FAIL committed=${r.committed} ${r.reason ?? ''}`),
  )
}
