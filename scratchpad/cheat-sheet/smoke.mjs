// Sanity: does node() capture what the harness assumes?
import { node, parser, sequence, literal, many, optional, regex, token } from 'parseman'
import { arity, positional, raw, describe } from './harness.mjs'

const ident = token(regex(/[a-z][-a-z0-9]*/))

console.log('literal alone      :', arity(literal('a'), 'a'))
console.log('sequence of 3      :', arity(sequence(literal('a'), literal('b'), literal('c')), 'abc'))
console.log('many(ident) 3 items:', arity(many(ident), 'abc', { trivia: null }))
console.log('---- THE many() SPREAD CLAIM ----')
const item = token(regex(/[a-z]/))
console.log('{ many } positional:', positional(many(item), '<abc>'))
console.log('---- THE optional() SHIFT CLAIM ----')
console.log('optional present   :', positional(optional(literal('x')), '<x>'))
console.log('optional absent    :', positional(optional(literal('x')), '<>'))
console.log('---- literal dropped? ----')
console.log('seq lit+ident      :', arity(sequence(literal('('), ident, literal(')')), '(abc)'))
