/**
 * Round-2 probes: the three questions round 1 raised.
 *
 * 1. Does a parameterless combinator const dedupe repeated terminal SITES?
 * 2. What does `node()` itself cost, isolated from its inner combinator?
 * 3. Does putting a rule in the returned map (making it a named rule) cost
 *    artifact bytes, as the override invariant implies it should?
 */
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;

const LITERALS = [
  ')', '(', '}', '{', ',', ']', '[', ';', '-', '\\\'', '"', ':', '/', '.', '*',
  '&', '%', '~', '|', '^', '?', '>', '=', '<', '+', '$', '~\\\'', '~"', '@', '!'
];

const HEAD = '/** Generated probe - see gen2.mjs. Not a shipped grammar. */\n';

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

/* p12 - 219 literal SITES, but each spelling declared once as a const. */
{
  const decls = LITERALS.map((l, i) => `  const t${i} = literal('${l}');`);
  const sites = [];
  for (let i = 0; i < 219; i++) {
    sites.push(`    t${i % LITERALS.length}`);
  }
  write('p12-litconst219', ['choice', 'literal', 'regex', 'rules'],
    `${decls.join('\n')}\n  const Start = choice(\n${sites.join(',\n')}\n  );\n`, 'Start');
}

/* p14 - 20 node() over a bare literal: isolates the node() wrapper cost. */
{
  const arms = [];
  for (let i = 0; i < 20; i++) {
    arms.push(`    node('N${i}', literal('${LITERALS[i]}'), children => children[0])`);
  }
  write('p14-nodelit20', ['choice', 'literal', 'node', 'regex', 'rules'],
    `  const Start = choice(\n${arms.join(',\n')}\n  );\n`, 'Start');
}

/* p15 - control for p14: the same 20 literals with no node() wrapper. */
{
  const arms = LITERALS.slice(0, 20).map(l => `    literal('${l}')`);
  write('p15-lit20', ['choice', 'literal', 'regex', 'rules'],
    `  const Start = choice(\n${arms.join(',\n')}\n  );\n`, 'Start');
}

/* p16 - one helper const referenced 20 times inside 20 named rules. */
{
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = node('N${i}', sequence(literal('('), shared, literal(')')), children => children[1]);`);
  }
  write('p16-sharedconst20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${Array.from({ length: 20 }, (_, i) => `N${i}`).join(', ')});\n`,
    'Start');
}

/* p17 - p16's shape with the 20 rules also EXPORTED in the map (named rules). */
{
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = node('N${i}', sequence(literal('('), shared, literal(')')), children => children[1]);`);
  }
  write('p17-mapped20', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${Array.from({ length: 20 }, (_, i) => `N${i}`).join(', ')});\n`,
    `Start, ${Array.from({ length: 20 }, (_, i) => `N${i}`).join(', ')}`);
}

/* p18 - 40 node() rules, to confirm node() cost is linear and not amortised. */
{
  const decls = [];
  for (let i = 0; i < 40; i++) {
    decls.push(`  const N${i} = node('N${i}', sequence(literal('('), shared, literal(')')), children => children[1]);`);
  }
  write('p18-node40', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${Array.from({ length: 40 }, (_, i) => `N${i}`).join(', ')});\n`,
    'Start');
}

/* p19 - 20 transform() rules instead of node(): is a CST boundary the cost? */
{
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = transform(sequence(literal('('), shared, literal(')')), children => children[1]);`);
  }
  write('p19-transform20', ['choice', 'literal', 'regex', 'rules', 'sequence', 'transform'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${Array.from({ length: 20 }, (_, i) => `N${i}`).join(', ')});\n`,
    'Start');
}

/* p20 - 20 plain sequences, no node() and no transform(): the floor for p16. */
{
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = sequence(literal('('), shared, literal(')'));`);
  }
  write('p20-seq20', ['choice', 'literal', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${Array.from({ length: 20 }, (_, i) => `N${i}`).join(', ')});\n`,
    'Start');
}

console.log('generated round 2');
