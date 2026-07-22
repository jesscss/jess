import { describe, expect, it } from 'vitest';
import { preserveRecoveryManifestVersion } from '../release-utils.mjs';

describe('preserveRecoveryManifestVersion', () => {
  it('takes only version from recovery and retains every imported manifest field', () => {
    const imported = {
      name: '@jesscss/less-parser',
      version: '2.0.0-alpha.5',
      exports: { root: './lib/index.js' },
      peerDependencies: { parseman: '^0.28.1' },
      devDependencies: { parseman: '0.28.1' }
    };
    const recovery = {
      name: '@jesscss/less-parser',
      version: '2.0.0-alpha.9',
      peerDependencies: { parseman: '^0.28.0' }
    };

    expect(preserveRecoveryManifestVersion(imported, recovery)).toEqual({
      ...imported,
      version: '2.0.0-alpha.9'
    });
  });

  it('rejects recovery manifests without a usable version', () => {
    expect(() =>
      preserveRecoveryManifestVersion({ name: 'x' }, { name: 'x' })
    ).toThrow(/non-empty string version/);
  });
});
