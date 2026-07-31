/**
 * Round-6 probes: Candidate A measured naming a rule as COSTING 904 B and
 * Candidate B measured it as SAVING 984 B. Opposite sign, near-identical
 * magnitude, so it is one mechanism seen from two sides rather than two
 * results. The suspected reconciliation:
 *
 *   naming a rule and STILL passing the const at the call site emits it twice
 *   (inlined at the site AND as a named rule) -> a name costs;
 *   naming a rule and referencing it BY NAME (`g.X`) at the call site emits it
 *   once -> a name saves.
 *
 * p27 (const arms, unmapped) and p33 (const arms, mapped) are the A side.
 * p34 (g.X arms, mapped) is the missing cell.
 */
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const HEAD = '/** Generated probe - see gen6.mjs. Not a shipped grammar. */\n';

const names20 = Array.from({ length: 20 }, (_, i) => `N${i}`);

const decls20 = () => {
  const out = ['  const shared = regex(/[a-z]+/);'];
  for (const name of names20) {
    out.push(`  const ${name} = node('${name}', sequence(literal('('), shared, literal(')')), children => children[1]);`);
  }
  return out.join('\n');
};

function write(name, param, body, map) {
  writeFileSync(
    `${here}${name}.ts`,
    `${HEAD}import { choice, literal, node, regex, rules, sequence } from 'parseman' with { type: 'macro' };\n`
    + 'import type { Combinator } from \'parseman\';\n\n'
    + 'const whitespace = regex(/[ \\t\\n\\r\\f]+/);\n\n'
    + `const probeFactory = (${param}: Record<string, Combinator>) => {\n`
    + `${body}\n  return { ${map} };\n};\n\n`
    + 'export const probeGrammar = rules({ trivia: whitespace }, probeFactory);\n'
  );
}

/* p34 - mapped rules, call site references them BY NAME through the proxy. */
write('p34-byname20', 'g',
  `${decls20()}\n  const Start = choice(${names20.map(n => `g.${n}`).join(', ')});\n`,
  `Start, ${names20.join(', ')}`);

/* p35 - p34 with THREE call sites, all by name: does reuse now pay? */
write('p35-byname20x3', 'g',
  `${decls20()}\n`
  + `  const A = choice(${names20.map(n => `g.${n}`).join(', ')});\n`
  + `  const B = choice(${names20.map(n => `g.${n}`).join(', ')});\n`
  + `  const C = choice(${names20.map(n => `g.${n}`).join(', ')});\n`
  + '  const Start = choice(A, B, C);\n',
  `Start, ${names20.join(', ')}`);

console.log('generated round 6');
