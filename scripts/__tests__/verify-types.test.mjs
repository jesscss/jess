import assert from 'node:assert/strict';
import test from 'node:test';
import { countTypeScriptDiagnostics, orderBuildPackages, typecheckInvocation } from '../verify-types.mjs';

function pkg(name, dependencies = {}) {
  return {
    name,
    manifest: { name, dependencies }
  };
}

test('orders strict build configs after their workspace dependencies', () => {
  const ordered = orderBuildPackages([
    pkg('@jesscss/jess', { '@jesscss/core': 'workspace:*' }),
    pkg('@jesscss/core', { '@jesscss/awaitable': 'workspace:*' }),
    pkg('@jesscss/awaitable')
  ]);
  assert.deepEqual(ordered.map(entry => entry.name), [
    '@jesscss/awaitable',
    '@jesscss/core',
    '@jesscss/jess'
  ]);
});

test('fails closed on dependency cycles', () => {
  assert.throws(() => orderBuildPackages([
    pkg('@jesscss/a', { '@jesscss/b': 'workspace:*' }),
    pkg('@jesscss/b', { '@jesscss/a': 'workspace:*' })
  ]), /Cycle detected/u);
});

test('counts only TypeScript error diagnostics', () => {
  assert.equal(countTypeScriptDiagnostics([
    'src/a.ts(1,1): error TS2322: mismatch',
    'src/b.ts(2,2): warning TS9999: warning',
    'src/c.ts(3,3): error TS2345: mismatch'
  ].join('\n')), 2);
});

test('invokes the workspace-pinned compiler from the repository root', () => {
  const rootDir = '/workspace/jess';
  const invocation = typecheckInvocation({
    dir: '/workspace/jess/packages/scss-parser'
  }, rootDir);
  assert.equal(invocation.cwd, rootDir);
  assert.deepEqual(invocation.args, [
    '-w', 'exec', 'tsc', '-p', 'packages/scss-parser/tsconfig.build.json',
    '--noEmit', '--pretty', 'false'
  ]);
});
