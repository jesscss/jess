import * as G from '../src/grammar.js';
test('grammar is macro-compiled (not interpreted) under vitest', () => {
  // compiled rules are plain functions; interpreted ones are Combinator objects
  expect(typeof G.Stylesheet).toBe('function');
  expect(typeof G.Ruleset).toBe('function');
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  expect((G.Stylesheet as any)._def).toBeUndefined();
  expect((G.Stylesheet as any).parse).toBeUndefined();
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
});
