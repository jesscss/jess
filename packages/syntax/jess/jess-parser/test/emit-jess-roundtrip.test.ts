/**
 * The `.jess` source emitter (`emitJess`, `@jesscss/core`) is the inverse of this
 * grammar. Its canonical test needs no other dialect: for every hand-written
 * `.jess` fixture in the repo, printing the parsed tree and parsing the print
 * gives back the same tree.
 *
 * Source spans and serializer memos (`_`-prefixed fields) are positions in the
 * text that was parsed, so they are the one thing a re-print is allowed to move.
 */
import { describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emitJess, NoJessSpelling } from '@jesscss/core';
import { operation, dimension } from '@jesscss/core/ast';
import type { Stylesheet } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * `.jess` sources the parser rejects have no tree to round-trip. Named, so one
 * that starts parsing fails here until it joins the round trip.
 */
const UNPARSEABLE = new Map<string, string>([
  ['packages/jess/benchmark/chunk.jess', 'stale benchmark port: bare `$a * 5` math outside `$( … )` (ledger P17 rejects it)']
]);

/** Every `.jess` source in the repo except the parser's deliberately-invalid error fixtures. */
const FIXTURES = glob.sync('packages/**/*.jess', {
  cwd: repo,
  ignore: ['**/node_modules/**', '**/lib/**', 'packages/syntax/jess/jess-parser/test/errors/**']
}).sort();

const shape = (root: Stylesheet): string =>
  JSON.stringify(root, (key, value: unknown) => (key.startsWith('_') ? undefined : value), 1);

describe('emitJess round-trips every .jess fixture', () => {
  it('finds the fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThan(15);
  });

  for (const [file, reason] of UNPARSEABLE) {
    it(`${file} still does not parse (${reason})`, () => {
      expect(() => parse(readFileSync(path.join(repo, file), 'utf8'))).toThrow();
    });
  }

  for (const file of FIXTURES.filter(f => !UNPARSEABLE.has(f))) {
    it(file, () => {
      const first = parse(readFileSync(path.join(repo, file), 'utf8'));
      const printed = emitJess(first);
      expect(shape(parse(printed))).toBe(shape(first));
      expect(emitJess(parse(printed))).toBe(printed);
    });
  }
});

describe('emitJess never approximates', () => {
  it('names the node it cannot spell', () => {
    const root = parse('.a { b: $(1 + 2); }');
    const [rule] = root.rules;
    if (rule?.type !== 'Ruleset' || rule.rules[0]?.type !== 'Declaration') {
      throw new Error('unexpected fixture shape');
    }

    // Bare math — the shape the Less AST carries until ledger P35 lands.
    rule.rules[0] = { ...rule.rules[0], value: operation('+', dimension(1), dimension(2), false, true) };
    expect(() => emitJess(root)).toThrow(NoJessSpelling);
    expect(() => emitJess(root)).toThrow('NoJessSpelling: Operation (math outside an `Expression`');
  });
});
