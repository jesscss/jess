// Deliberately-failing assignments, so tsc PRINTS the inferred value type of
// each shape. Every line below is EXPECTED to error; the error text is the
// measurement. Not part of run-all.mjs.
import { choice, dispatch, when, otherwise, routed, literal, token, regex, sequence, optional, noTrivia, node, transform } from 'parseman'

const lit = (s: string) => token(literal(s))
const opener = token(noTrivia(sequence(regex(/[a-z]+/), optional(literal('(')))))
const Url = node('Url', sequence(routed(), literal(')')), (c) => c.slice())
const Kw = node('Kw', routed(), (c) => c.slice())

const rd = dispatch(opener, when('url(', Url), otherwise(Kw))
const showDispatch: 1 = rd

const anonA = transform(lit('a'), () => ({ kind: 'a', span: 1 }))
const anonB = transform(lit('b'), () => ({ kind: 'b', extra: true }))
const ac = choice(anonA, anonB)
const showAnon: 1 = ac

const seven = choice(lit('a'), lit('b'), lit('c'), lit('d'), lit('e'), lit('f'), lit('g'))
const showSeven: 1 = seven

export { showDispatch, showAnon, showSeven }
