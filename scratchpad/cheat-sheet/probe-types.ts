// TYPE-LEVEL PROBE: which bare-choice() shapes can be promoted into a named
// rule slot typed as an invariant `Combinator<T>`?
// Run: npx tsc --noEmit --strict --module esnext --moduleResolution bundler \
//        scratchpad/cheat-sheet/probe-types.ts
import {
  choice, dispatch, when, otherwise, routed, literal, token, regex, sequence,
  optional, noTrivia, node, transform,
} from 'parseman'
import type { Combinator } from 'parseman'

const lit = (s: string) => token(literal(s))

// ---- CONTROL: a SEVEN-member union promotes fine ------------------------
// If union width were the blocker, this would fail. It does not.
const seven = choice(lit('a'), lit('b'), lit('c'), lit('d'), lit('e'), lit('f'), lit('g'))
const sevenPromoted: Combinator<string> = seven

// A seven-member union of DISTINCT value types also promotes, given a spellable
// union in the slot.
const n1 = transform(lit('1'), () => 1 as const)
const n2 = transform(lit('2'), () => 'two' as const)
const n3 = transform(lit('3'), () => true as const)
const mixed = choice(n1, n2, n3)
const mixedPromoted: Combinator<1 | 'two' | true> = mixed

// ---- BLOCKER 1: dispatch() surfaces a TUPLE [routedValue, branchResult] --
const opener = token(noTrivia(sequence(regex(/[a-z]+/), optional(literal('(')))))
const Url = node('Url', sequence(routed(), literal(')')), (c) => c.slice())
const Kw = node('Kw', routed(), (c) => c.slice())
const routedDispatch = dispatch(opener, when('url(', Url), otherwise(Kw))

// The inferred value is a TUPLE, not the branch result. Spelling it in an
// invariant slot is what breaks promotion in practice.
type RoutedValue = typeof routedDispatch extends Combinator<infer T> ? T : never
// Uncomment to see the shape the compiler actually infers:
// const _showTuple: RoutedValue = null as never

// ---- BLOCKER 2: anonymous object types in the union ---------------------
const anonA = transform(lit('a'), () => ({ kind: 'a', span: 1 }))
const anonB = transform(lit('b'), () => ({ kind: 'b', extra: true }))
const anonChoice = choice(anonA, anonB)
// The union of two ANONYMOUS object types has no name to write in the slot.
// Promotion requires either naming both shapes or widening — neither is free.
type AnonUnion = typeof anonChoice extends Combinator<infer T> ? T : never
const anonPromoted: Combinator<AnonUnion> = anonChoice // only works via infer

export { sevenPromoted, mixedPromoted, routedDispatch, anonPromoted }
export type { RoutedValue, AnonUnion }
