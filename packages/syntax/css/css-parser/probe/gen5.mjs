/**
 * Round-5 probes: the chain (round 3) held 20 node() rules for 2.8 KB while the
 * sibling shape (round 4) held 20 node() rules for 104 KB. The structural
 * difference is that every chain rule is reachable from TWO places (the choice
 * and its predecessor) while every sibling rule is reachable from ONE.
 *
 * Hypothesis: a combinator reached once is INLINED and its frame duplicated;
 * a combinator reached twice or more is emitted once and shared. If true, the
 * 3,425 B measured "per node()" is really the price of INLINING a node(), and
 * sharing is nearly free.
 */
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const HEAD = '/** Generated probe - see gen5.mjs. Not a shipped grammar. */\n';

function write(name, imports, body, map) {
  writeFileSync(
    `${here}${name}.ts`,
    `${HEAD}import { ${imports.join(', ')} } from 'parseman' with { type: 'macro' };\n\n`
    + 'const whitespace = regex(/[ \\t\\n\\r\\f]+/);\n\n'
    + 'const probeFactory = (_g: Record<string, never>) => {\n'
    + `${body}\n  return { ${map} };\n};\n\n`
    + 'export const probeGrammar = rules({ trivia: whitespace }, probeFactory);\n'
  );
}

const decls20 = () => {
  const out = ['  const shared = regex(/[a-z]+/);'];
  for (let i = 0; i < 20; i++) {
    out.push(`  const N${i} = node('N${i}', sequence(literal('('), shared, literal(')')), children => children[1]);`);
  }
  return out.join('\n');
};

const names20 = Array.from({ length: 20 }, (_, i) => `N${i}`);

/* p31 - each rule reachable from TWO choices. Nothing else changes vs p27. */
write('p31-tworefs20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
  `${decls20()}\n`
  + `  const A = choice(${names20.join(', ')});\n`
  + `  const B = choice(${names20.join(', ')});\n`
  + '  const Start = choice(A, B);\n',
  'Start');

/* p32 - each rule reachable from THREE choices: is sharing already saturated? */
write('p32-threerefs20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
  `${decls20()}\n`
  + `  const A = choice(${names20.join(', ')});\n`
  + `  const B = choice(${names20.join(', ')});\n`
  + `  const C = choice(${names20.join(', ')});\n`
  + '  const Start = choice(A, B, C);\n',
  'Start');

/* p33 - single reference, but every rule is in the returned map as well. */
write('p33-mappedonly20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
  `${decls20()}\n`
  + `  const Start = choice(${names20.join(', ')});\n`,
  `Start, ${names20.join(', ')}`);

console.log('generated round 5');
