import { run } from 'parseman';
import { parseJessCst } from '../src/cst.js';
import { jessGrammar } from '../src/grammar.js';

test('macro-compiled Jess call components retain modern CSS slash separators structurally', () => {
  const valid = '.card { box-shadow: rgb(15 23 42 / 0.22); }';
  const cst = parseJessCst(valid);
  const direct = run(jessGrammar.Stylesheet, valid, { trivia: jessGrammar.whitespace });
  expect(cst.errors).toHaveLength(0);
  expect(cst.unconsumedFrom).toBeNull();
  expect(direct.ok && direct.unconsumedFrom === null && direct.value?.type === 'Stylesheet').toBe(true);

  /* A second slash is a direct-neighbour group the css base also accepts (P33). */
  for (const invalid of [
    '.card { color: rgb(/ 0.22); }',
    '.card { color: rgb(15 23 42 /); }'
  ]) {
    const cst = parseJessCst(invalid);
    const result = run(jessGrammar.Stylesheet, invalid, { trivia: jessGrammar.whitespace });
    expect(!cst.ok || cst.errors.length + Number(cst.unconsumedFrom !== null) > 0, invalid).toBe(true);
    expect(result.ok && result.unconsumedFrom === null, invalid).toBe(false);
  }
});
