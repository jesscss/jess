// STRUCTURAL / BUILD-TIME PROBE: rules, ref, compose, composeLeaf, compile,
// dispatch matchers, gate, withCtx, and the documented authoring hard-fails.
import {
  rules, ref, compose, composeLeaf, compile, dispatch, when, makeWhen, startsWith,
  endsWith, matches, otherwise, routed, literal, regex, token, sequence, choice,
  optional, many, node, gate, withCtx, parse, noTrivia, word, keywords,
} from 'parseman'

const ok = (label, fn) => {
  try { const v = fn(); return { label, ok: true, note: typeof v } }
  catch (e) { return { label, ok: false, note: e.message.split('\n')[0].slice(0, 120) } }
}

const results = []

// ---- composeLeaf preconditions ------------------------------------------
const leafSyntax = rules({ trivia: null }, (g) => ({ Ident: token(regex(/[a-z]+/)) }))
const leafSyntax2 = rules({ trivia: null }, (g) => ({ Num: token(regex(/[0-9]+/)) }))
results.push(ok('composeLeaf([oneLeaf])            (< 2 leaves)', () => composeLeaf([leafSyntax])))
results.push(ok('composeLeaf([leafA, leafB])       (2 leaves)', () => composeLeaf([leafSyntax, leafSyntax2])))
results.push(ok('composeLeaf([]) ', () => composeLeaf([])))
const HOISTED = 'red'
results.push(ok('composeLeaf w/ hoisted plain string', () => composeLeaf([HOISTED, leafSyntax])))

// ---- rules() factory shape ----------------------------------------------
results.push(ok('rules(opts, g => ({...}))  named factory', () => {
  const factory = (g) => ({ A: token(regex(/a/)), B: sequence(literal('<'), g.A, literal('>')) })
  return rules({ trivia: null }, factory)
}))
results.push(ok('rules(opts, INLINE arrow)', () => rules({ trivia: null }, (g) => ({ A: token(regex(/a/)) }))))

// ---- ref() ---------------------------------------------------------------
results.push(ok('ref() then .define()', () => { const r = ref(); r.define(token(regex(/a/))); return r }))
results.push(ok('ref() used WITHOUT define()', () => {
  const r = ref()
  return parse(r, 'a', {})
}))

// ---- dispatch matchers ---------------------------------------------------
const opener = token(noTrivia(sequence(regex(/[a-z-]+/), optional(literal('(')))))
function dispatchWith(arm) {
  return dispatch(opener, arm, otherwise(node('Kw', routed(), (c) => c.slice())))
}
const matcherCases = [
  ['when(exact)', when('url(', node('X', sequence(routed(), literal(')')), (c) => c.slice())), 'url()'],
  ['startsWith', when(startsWith('-webkit'), node('X', routed(), (c) => c.slice())), '-webkit-box'],
  ['endsWith', when(endsWith('('), node('X', sequence(routed(), literal(')')), (c) => c.slice())), 'foo()'],
  ['matches(regex)', when(matches(/^--/), node('X', routed(), (c) => c.slice())), '--custom'],
  ['makeWhen ci', makeWhen({ caseInsensitive: true })('URL(', node('X', sequence(routed(), literal(')')), (c) => c.slice())), 'url()'],
]
for (const [label, arm, input] of matcherCases) {
  results.push(ok(`dispatch ${label}  on ${JSON.stringify(input)}`, () => {
    const r = parse(dispatchWith(arm), input, { recover: true })
    if (!r.ok) throw new Error('parse failed')
    return r.value
  }))
}

// ---- the reported static-evaluation failure shape ------------------------
results.push(ok("when('url(', X, { caseInsensitive: true })  option-object", () => {
  const X = node('X', sequence(routed(), literal(')')), (c) => c.slice())
  return dispatch(opener, when('url(', X, { caseInsensitive: true }), otherwise(node('Kw', routed(), (c) => c.slice())))
}))

// ---- gate / withCtx ------------------------------------------------------
results.push(ok('gate(pred) alone', () => parse(gate(() => true), '', {})))
results.push(ok('withCtx(extra, combinator)', () => parse(withCtx({ mathMode: 1 }, token(regex(/a/))), 'a', {})))

// ---- compile -------------------------------------------------------------
results.push(ok('compile(rules(...))', () => compile(rules({ trivia: null }, (g) => ({ A: token(regex(/a/)) })))))

const w = (s, n) => String(s).padEnd(n)
console.log(w('CONSTRUCT', 52) + w('BUILDS?', 9) + 'NOTE / ERROR')
console.log('-'.repeat(130))
for (const r of results) console.log(w(r.label, 52) + w(r.ok ? 'yes' : 'NO', 9) + r.note)

// ---- gate() semantics ----------------------------------------------------
console.log('\n' + '='.repeat(90) + '\ngate() — predicate over ctx state, ZERO-WIDTH, contributes what?\n' + '='.repeat(90))
for (const pred of [() => true, () => false]) {
  const r = parse(sequence(gate(pred), token(regex(/a/))), 'a', { recover: true })
  console.log(`  gate(()=>${pred()}) : ok=${r.ok} span=${r.ok ? `{${r.span.start},${r.span.end}}` : 'n/a'}` +
    ` value=${r.ok ? JSON.stringify(r.value) : '-'}`)
}

// ---- BARE choice() PROMOTION: what makes the union unspellable? ----------
console.log('\n' + '='.repeat(90) + '\nBARE choice() PROMOTION — which shapes surface an unspellable union\n' + '='.repeat(90))
console.log('  This is a TYPE-level property; the runtime cannot see it.')
console.log('  Measured by typecheck instead:')
console.log('    npx tsc --noEmit --ignoreConfig --strict --skipLibCheck --target es2022 \\')
console.log('      --module esnext --moduleResolution bundler scratchpad/cheat-sheet/probe-types.ts')
console.log('      -> compiles clean (the promotable shapes)')
console.log('    ...same command on scratchpad/cheat-sheet/tupleprobe.ts')
console.log('      -> 3 EXPECTED errors that print the inferred types:')
console.log('         dispatch  -> Combinator<[string, unknown[]]>   (tuple: BLOCKER)')
console.log('         anon choice -> Combinator<{kind;span} | {kind;extra}>  (BLOCKER)')
console.log('         7-arm choice -> Combinator<string>             (promotes fine)')
