/**
 * Does parseman 0.45.0 actually fail to express "exclude a positionally
 * reserved opener from <general-enclosed> INSIDE the @import tail, while the
 * SAME shared rule keeps accepting it under @media"?
 *
 * The scss shrink lane recorded that as `blocked` on the grounds that it needs a
 * context-parameterised override and parseman's parameterless-const rule cannot
 * express one. This is the direct test of that claim. Every const below is
 * parameterless — no factories, no spread, no hoisted regex — so if this
 * discriminates, the claim is false as stated.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require_ = createRequire(resolve(process.cwd(), 'packages/syntax/scss/scss-parser/noop.js'));
const parsemanEntry = require_.resolve('parseman');
const pm = await import(parsemanEntry.replace(/\.cjs$/, '.js'));
const { sequence, choice, literal, many, optional, not, regex, withCtx, run, ref, rules } = pm;

const ws = regex(/[ \t\n]*/);
const ident = regex(/[A-Za-z_][A-Za-z0-9_-]*/);
const anyValue = regex(/[^()]*/);

/** `<general-enclosed>` = any function token + <any-value> + ')'. Shared. */
const GeneralEnclosedLoose = sequence(ident, literal('('), anyValue, literal(')'));

/** The openers css-cascade-5 §3.1 reserves for a POSITION earlier in the tail. */
const ReservedOpener = choice(
  sequence(literal('layer'), ws, literal('(')),
  sequence(literal('supports'), ws, literal('('))
);

const GeneralEnclosedStrict = sequence(not(ReservedOpener), GeneralEnclosedLoose);

/**
 * ONE shared const, two behaviours, selected by a cheap state predicate on the
 * choice ARM — which is exactly what `gate:` as an arm field is documented for.
 */
const GeneralEnclosed = choice(
  { gate: state => state?.reservedOpenersForbidden === true, combinator: GeneralEnclosedStrict },
  GeneralEnclosedLoose
);

const QueryClause = sequence(ws, GeneralEnclosed, ws);
const MediaQueryList = QueryClause;

/** @media: the shared rule keeps its full <general-enclosed> breadth. */
const MediaRule = sequence(literal('@media'), MediaQueryList);

/** @import: the SAME rule, narrowed for the duration of the tail only. */
const ImportTail = withCtx({ reservedOpenersForbidden: true }, MediaQueryList);
const ImportRule = sequence(literal('@import'), ws, regex(/"[^"]*"/), ImportTail);

const cases = [
  ['@media', MediaRule, '@media layer(theme)', 'accept — <general-enclosed>, no positional reservation'],
  ['@media', MediaRule, '@media foo(bar)', 'accept'],
  ['@import', ImportRule, '@import "a" foo(bar)', 'accept — valid <general-enclosed>'],
  ['@import', ImportRule, '@import "a" layer(theme)', 'REJECT — wrong order per css-cascade-5 §3.1'],
  ['@import', ImportRule, '@import "a" supports(d: e)', 'REJECT — wrong order']
];

for (const [name, g, src, want] of cases) {
  const r = run(g, src, {});
  const consumed = r.ok && r.unconsumedFrom === null;
  console.log(`${consumed ? 'ACCEPT' : 'REJECT'}  ${name.padEnd(8)} ${JSON.stringify(src).padEnd(30)} want: ${want}`);
}
