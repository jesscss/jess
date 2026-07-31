/**
 * Round-4 probes: round 3 falsified round 2's per-node() price, so isolate the
 * real driver. Round 2 compared 20 SIBLING rules that each contained a regex
 * site; round 3's chain had 20 node() rules and ONE regex site and cost 2.8 KB
 * against round 2's 104 KB. Either node() is not the cost, or a regex SITE is.
 */
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const HEAD = '/** Generated probe - see gen4.mjs. Not a shipped grammar. */\n';

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

function siblings(name, count, inner, imports) {
  const decls = [];
  for (let i = 0; i < count; i++) {
    decls.push(`  const N${i} = node('N${i}', sequence(literal('('), ${inner}, literal(')')), children => children[1]);`);
  }
  const names = Array.from({ length: count }, (_, i) => `N${i}`);
  write(name, imports,
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${names.join(', ')});\n`,
    'Start');
}

/* p26 - 20 sibling node() rules, inner = a LITERAL. No regex site. */
siblings('p26-sib20lit', 20, 'literal(\'x\')', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence']);

/* p27 - identical, inner = a shared REGEX const. 20 regex sites. */
siblings('p27-sib20re', 20, 'shared', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence']);

/* p28 - 20 sibling rules with DISTINCT leading literals: disjoint first sets. */
{
  const alphabet = 'abcdefghijklmnopqrst';
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = node('N${i}', sequence(literal('${alphabet[i]}'), shared, literal(')')), children => children[1]);`);
  }
  const names = Array.from({ length: 20 }, (_, i) => `N${i}`);
  write('p28-sib20disjoint', ['choice', 'literal', 'node', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${names.join(', ')});\n`,
    'Start');
}

/* p29 - p27 without node(): is the wrapper or the ambiguity the cost? */
{
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = sequence(literal('('), shared, literal(')'));`);
  }
  const names = Array.from({ length: 20 }, (_, i) => `N${i}`);
  write('p29-sib20nonode', ['choice', 'literal', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${names.join(', ')});\n`,
    'Start');
}

/* p30 - p28 (disjoint first sets) without node(). */
{
  const alphabet = 'abcdefghijklmnopqrst';
  const decls = [];
  for (let i = 0; i < 20; i++) {
    decls.push(`  const N${i} = sequence(literal('${alphabet[i]}'), shared, literal(')'));`);
  }
  const names = Array.from({ length: 20 }, (_, i) => `N${i}`);
  write('p30-sib20disjointnonode', ['choice', 'literal', 'regex', 'rules', 'sequence'],
    '  const shared = regex(/[a-z]+/);\n'
    + `${decls.join('\n')}\n`
    + `  const Start = choice(${names.join(', ')});\n`,
    'Start');
}

console.log('generated round 4');
