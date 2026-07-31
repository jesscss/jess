/**
 * Round-3 probes: does codegen scale linearly in the number of MAPPED rules,
 * or superlinearly? The answer decides whether "fewest combinators" is worth
 * more than the 904 B/rule that round 2 priced a name at.
 *
 * Every probe is the same grammar shape at a different rule count, with each
 * rule referencing its successor so the reference graph grows with N too.
 */
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const HEAD = '/** Generated probe - see gen3.mjs. Not a shipped grammar. */\n';

function chain(name, count, mapped) {
  const decls = [];
  for (let i = count - 1; i >= 0; i--) {
    const tail = i === count - 1 ? 'shared' : `N${i + 1}`;
    decls.push(`  const N${i} = node('N${i}', sequence(literal('('), ${tail}, literal(')')), children => children[1]);`);
  }
  const names = Array.from({ length: count }, (_, i) => `N${i}`);
  const map = mapped ? `Start, ${names.join(', ')}` : 'Start';
  writeFileSync(
    `${here}${name}.ts`,
    `${HEAD}import { choice, literal, node, regex, rules, sequence } from 'parseman' with { type: 'macro' };\n\n`
    + 'const whitespace = regex(/[ \\t\\n\\r\\f]+/);\n\n'
    + 'const probeFactory = (_g: Record<string, never>) => {\n'
    + '  const shared = regex(/[a-z]+/);\n'
    + `${decls.reverse().join('\n')}\n`
    + `  const Start = choice(${names.join(', ')});\n\n`
    + `  return { ${map} };\n};\n\n`
    + 'export const probeGrammar = rules({ trivia: whitespace }, probeFactory);\n'
  );
}

chain('p21-chain10', 10, false);
chain('p22-chain20', 20, false);
chain('p23-chain40', 40, false);
chain('p24-chain80', 80, false);
chain('p25-chain80mapped', 80, true);

console.log('generated round 3');
