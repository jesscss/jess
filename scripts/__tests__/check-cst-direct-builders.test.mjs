import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDirectBuilders } from '../check-cst-direct-builders.mjs';

const kinds = source => findDirectBuilders('/tmp/grammar.ts', source).map(f => f.text);

describe('CST direct-builder detector', () => {
  it('accepts a structural node in both overloads', () => {
    assert.deepEqual(kinds('const A = node(sequence(a, b));'), []);
    assert.deepEqual(kinds('const A = node(\'Operation\', sequence(a, b));'), []);
  });

  it('accepts an options object in the build slot (short overload)', () => {
    assert.deepEqual(kinds('const A = node(seq, { collapse: true });'), []);
  });

  it('accepts the explicit undefined placeholder used to reach opts', () => {
    /* The four CST grammars spell this 22 times. */
    assert.deepEqual(kinds('const A = node(\'Operation\', seq, undefined, { collapse: true });'), []);
    assert.deepEqual(kinds('const A = node(\'Operation\', seq, void 0, { collapse: true });'), []);
  });

  it('REPORTS an arrow builder — the silent-node-loss case', () => {
    assert.deepEqual(kinds('const A = node(seq, children => ({ x: children }));'), ['children => ({ x: children })']);
    assert.deepEqual(kinds('const A = node(\'Decl\', seq, children => mk(children));'), ['children => mk(children)']);
  });

  it('REPORTS a function expression and a bare identifier builder', () => {
    assert.deepEqual(kinds('const A = node(seq, function (c) { return c; });'), ['function (c) { return c; }']);
    assert.deepEqual(kinds('const A = node(seq, buildDecl);'), ['buildDecl']);
  });

  it('reports the line of the offending argument', () => {
    const found = findDirectBuilders('/tmp/g.ts', '\n\nconst A = node(\n  seq,\n  c => c\n);');
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 5);
  });

  it('finds builders nested anywhere in the file, not just at top level', () => {
    assert.deepEqual(kinds('export const g = rules(() => { const A = node(seq, c => c); return { A }; });'), ['c => c']);
  });
});
