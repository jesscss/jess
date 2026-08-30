// balanced() / expect() RECOVERY PROBE.
// The error channel is wired by the exported `parse(combinator, input, { recover: true })`.
// `parser({...}).parse(input)` does NOT populate it — a probe built on `parser()`
// sees errors=0 and concludes "accepted" for input that was in fact RECOVERED.
import { parse, balanced, expect, literal, sequence, scanTo, regex, token, many } from 'parseman'

function show(label, X, src) {
  const r = parse(X, src, { recover: true })
  const errs = r.ok ? (r.errors ?? []) : []
  return {
    src: JSON.stringify(src),
    ok: r.ok,
    consumed: r.ok ? r.span.end - r.span.start : 0,
    errors: errs.length,
    messages: errs.map((e) => e.message ?? e.expected ?? '(err)').join(' | '),
  }
}

console.log('='.repeat(96))
console.log('balanced() — CONSUMPTION vs RECOVERY (errors surface ONLY under parse(..., {recover:true}))')
console.log('='.repeat(96))
const bal = balanced('(', ')', { skip: [balanced('[', ']'), balanced('{', '}')] })
const cases = ['(abc)', '(a[b]c)', '(a{b}c)', '([c}])', '(a[b)c]', '(unclosed', '(a[b]']
const w = (s, n) => String(s).padEnd(n)
console.log(w('INPUT', 14) + w('ok', 6) + w('consumed', 10) + w('#errors', 9) + 'RECOVERED DIAGNOSTIC')
console.log('-'.repeat(96))
for (const src of cases) {
  const r = show('balanced', bal, src)
  console.log(w(r.src, 14) + w(r.ok, 6) + w(r.consumed, 10) + w(r.errors, 9) + (r.messages || '-'))
}

console.log('\n' + '='.repeat(96))
console.log('THE var(--x, ([c}])) QUESTION — is a crossed closure legitimately ACCEPTED?')
console.log('='.repeat(96))
for (const src of ['var(--x, ([c}]))', 'var(--x, (a[b]))']) {
  const inner = sequence(literal('var('), scanTo(literal(')'), { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}')] }), literal(')'))
  const r = show('var', inner, src)
  console.log(`  ${w(r.src, 20)} ok=${w(r.ok, 6)} consumed=${w(r.consumed, 4)} errors=${r.errors}  ${r.messages || ''}`)
}

console.log('\n' + '='.repeat(96))
console.log('expect() — zero-width SUCCESS on failure, value is a ParseError, pushed to the error channel')
console.log('='.repeat(96))
const E = sequence(token(regex(/a/)), expect(literal(';'), 'semicolon'))
for (const src of ['a;', 'a']) {
  const r = parse(E, src, { recover: true })
  console.log(`  ${w(JSON.stringify(src), 8)} ok=${r.ok}  consumed=${r.ok ? r.span.end - r.span.start : 0}` +
    `  errors=${(r.errors ?? []).length}  values=${JSON.stringify((r.value ?? []).map?.((v) => (v && v._tag) || typeof v) ?? r.value)}`)
}

console.log('\n  -- expect() alone on input it cannot match --')
const r0 = parse(expect(literal(';'), 'semicolon'), 'zzz', { recover: true })
console.log(`  ok=${r0.ok}  span={${r0.span.start},${r0.span.end}}  ZERO-WIDTH SUCCESS=${r0.ok && r0.span.start === r0.span.end}` +
  `  errors=${(r0.errors ?? []).length}  value._tag=${r0.ok ? (r0.value && r0.value._tag) : 'n/a'}`)

console.log('\n  -- WHY many(expect(X)) IS A HANG/NO-PROGRESS HAZARD --')
const loop = many(expect(literal(';'), 'semicolon'))
const rl = parse(loop, 'zzz', { recover: true })
console.log(`  many(expect(...)) on "zzz": ok=${rl.ok} span={${rl.span.start},${rl.span.end}} errors=${(rl.errors ?? []).length}`)

console.log('\n' + '='.repeat(96))
console.log('A PURE-LOOKAHEAD REGEX: never matches the empty STRING, always matches ZERO-WIDTH')
console.log('='.repeat(96))
const la = /(?=a)/
console.log(`  ${String(la)}.exec('')      -> ${JSON.stringify(la.exec(''))}   <-- exec('') MISSES it`)
console.log(`  ${String(la)}.exec('abc')   -> match at ${la.exec('abc')?.index}, length ${la.exec('abc')?.[0].length}`)
const rla = parse(regex(la), 'abc', { recover: true })
console.log(`  parse(regex(${String(la)}), 'abc') -> ok=${rla.ok} span={${rla.span.start},${rla.span.end}} zero-width=${rla.span.start === rla.span.end}`)
