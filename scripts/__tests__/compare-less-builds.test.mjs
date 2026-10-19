/**
 * The corpus comparison in `scripts/compare-less-builds.mjs` reports fixtures by
 * name: added, removed and changed per output mode, where a changed error code
 * is a change like changed CSS.
 *
 * Run: `node --test scripts/__tests__/compare-less-builds.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { diffCorpus, diffNamedSets, formatCorpusDiff, parseArgs } from '../compare-less-builds.mjs';

const css = (sha256, bytes = 10) => ({ sha256, bytes });

test('identical sets have no added, removed or changed fixtures', () => {
  const set = { 'a.less': css('1'), 'b.less': { ...css('2'), errors: ['parse/syntax-error'] } };
  assert.deepEqual(diffNamedSets(set, structuredClone(set)), { added: [], removed: [], changed: [] });
});

test('fixtures are reported by name, sorted', () => {
  const before = { 'keep.less': css('1'), 'gone-b.less': css('2'), 'gone-a.less': css('3') };
  const after = { 'keep.less': css('1'), 'new-b.less': css('4'), 'new-a.less': css('5') };
  const diff = diffNamedSets(before, after);
  assert.deepEqual(diff.added, ['new-a.less', 'new-b.less']);
  assert.deepEqual(diff.removed, ['gone-a.less', 'gone-b.less']);
  assert.deepEqual(diff.changed, []);
});

test('a changed output, error code, warning or throw is a change, with the fields that moved', () => {
  const before = {
    'css.less': css('1', 10),
    'error.less': { ...css('2'), errors: ['parse/syntax-error'] },
    'warning.less': { ...css('3'), warnings: ['deprecation/less-plugin'] },
    'thrown.less': { thrown: 'import/not-found' },
    'starts-throwing.less': css('4')
  };
  const after = {
    'css.less': css('1b', 11),
    'error.less': { ...css('2'), errors: ['resolve/name-not-found'] },
    'warning.less': css('3'),
    'thrown.less': { thrown: 'import/load-failed' },
    'starts-throwing.less': { thrown: 'TypeError' }
  };
  const { changed } = diffNamedSets(before, after);
  assert.deepEqual(changed.map(({ name, fields }) => [name, fields]), [
    ['css.less', ['bytes', 'sha256']],
    ['error.less', ['errors']],
    ['starts-throwing.less', ['bytes', 'sha256', 'thrown']],
    ['thrown.less', ['thrown']],
    ['warning.less', ['warnings']]
  ]);
});

test('modes are compared separately and a mode missing on one side lists all its fixtures', () => {
  const before = { native: { 'a.less': css('1') }, compact: { 'a.less': css('1') } };
  const after = { native: { 'a.less': css('2') }, false: { 'a.less': css('1') } };
  const diff = diffCorpus(before, after);
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.modes.native.changed.map(change => change.name), ['a.less']);
  assert.deepEqual(diff.modes.compact.removed, ['a.less']);
  assert.deepEqual(diff.modes.false.added, ['a.less']);
  assert.equal(diffCorpus(before, structuredClone(before)).identical, true);
});

test('the report names every fixture and the change', () => {
  const report = formatCorpusDiff(diffCorpus(
    { native: { 'a.less': css('1', 10), 'b.less': { thrown: 'x' } }, compact: { 'a.less': css('1') } },
    { native: { 'a.less': css('2', 12), 'c.less': css('3') }, compact: { 'a.less': css('1') } }
  ));
  assert.equal(report, [
    'native:',
    '  added    c.less',
    '  removed  b.less',
    '  changed  a.less (css differs 10B -> 12B)',
    'compact: identical',
    'byteIdentical=false'
  ].join('\n'));
});

test('--corpus needs something to compare against or record to', () => {
  assert.throws(() => parseArgs(['--corpus']), /--before-root, --baseline or --record/);
  assert.throws(() => parseArgs(['--corpus', '--before-root', 'a', '--baseline', 'b']), /alternatives/);
  assert.equal(parseArgs(['--corpus', '--record', 'x.json']).record, 'x.json');
});
