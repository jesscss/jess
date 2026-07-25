import { describe, it, expect } from 'vitest';
// The release tooling is plain ESM (.mjs); import it directly.
import {
  compareSemver,
  findAllowlistDuplicates,
  isReleaseArtifactPath,
  nextAlphaAfter,
  resolveAlphaPublishVersion
} from '../release-utils.mjs';

/**
 * Build a minimal `plan` shaped like `getAlphaReleasePlan`'s output, carrying
 * only the fields the resolver reads: `errors`, `allowlist`, and `packages`
 * (each with a `manifest.version`).
 */
function makePlan(allowlist: string[], manifestVersion: string) {
  return {
    errors: [] as string[],
    allowlist,
    packages: allowlist.map(name => ({ manifest: { version: manifestVersion } }))
  };
}

/** Turn a map of pkg -> published versions into an injectable `viewVersions`. */
function viewFrom(published: Record<string, string[]>) {
  return (pkg: string): string[] => published[pkg] ?? [];
}

describe('compareSemver', () => {
  it('orders alpha numbers numerically, not lexically', () => {
    expect(compareSemver('2.0.0-alpha.9', '2.0.0-alpha.10')).toBe(-1);
    expect(compareSemver('2.0.0-alpha.10', '2.0.0-alpha.9')).toBe(1);
    expect(compareSemver('2.0.0-alpha.6', '2.0.0-alpha.6')).toBe(0);
  });

  it('ranks a higher minor above a higher alpha number', () => {
    expect(compareSemver('2.1.0-alpha.0', '2.0.0-alpha.6')).toBe(1);
  });

  it('ranks a release above its prerelease', () => {
    expect(compareSemver('2.0.0', '2.0.0-alpha.6')).toBe(1);
  });
});

describe('nextAlphaAfter', () => {
  it('increments the alpha number', () => {
    expect(nextAlphaAfter('2.0.0-alpha.6')).toBe('2.0.0-alpha.7');
  });
  it('throws on a non-alpha version', () => {
    expect(() => nextAlphaAfter('2.0.0')).toThrow(/non-alpha/);
  });
});

describe('isReleaseArtifactPath (clean-tree gate ignores build output)', () => {
  it('ignores build-generated artifacts', () => {
    expect(isReleaseArtifactPath('packages/jess/etc/jess.api.md')).toBe(true);
    expect(isReleaseArtifactPath('packages/core/lib/index.js')).toBe(true);
    expect(isReleaseArtifactPath('lib/foo.js')).toBe(true);
    expect(isReleaseArtifactPath('docs/state/PROJECT_STATE.md')).toBe(true);
  });
  it('does NOT ignore source changes', () => {
    expect(isReleaseArtifactPath('packages/core/src/tree/index.ts')).toBe(false);
    expect(isReleaseArtifactPath('scripts/release/release-utils.mjs')).toBe(false);
    expect(isReleaseArtifactPath('package.json')).toBe(false);
  });
});

describe('findAllowlistDuplicates (publish-set dup guard)', () => {
  it('returns [] for a unique allowlist', () => {
    expect(findAllowlistDuplicates(['@scope/a', '@scope/b', 'jess'])).toEqual([]);
  });
  it('reports each duplicated name exactly once, in first-seen order', () => {
    expect(
      findAllowlistDuplicates([
        '@jesscss/scss-parser',
        '@jesscss/plugin-scss',
        '@jesscss/scss-parser',
        '@jesscss/plugin-scss'
      ])
    ).toEqual(['@jesscss/scss-parser', '@jesscss/plugin-scss']);
  });
  it('reports a name once even when it appears three times', () => {
    expect(findAllowlistDuplicates(['x', 'x', 'x'])).toEqual(['x']);
  });
});

describe('resolveAlphaPublishVersion', () => {
  const allowlist = ['@scope/a', '@scope/b'];

  it('(a) stale intended below publishedMax → registry-guarded auto-increment', () => {
    const plan = makePlan(allowlist, '2.0.0-alpha.5');
    const viewVersions = viewFrom({
      ['@scope/a']: ['2.0.0-alpha.1', '2.0.0-alpha.6'],
      ['@scope/b']: ['2.0.0-alpha.5', '2.0.0-alpha.6']
    });
    const res = resolveAlphaPublishVersion({ plan, viewVersions });
    expect(res.intended).toBe('2.0.0-alpha.5');
    expect(res.publishedMax).toBe('2.0.0-alpha.6');
    expect(res.resolved).toBe('2.0.0-alpha.7');
    expect(res.reason).toBe('registry-guarded-increment');
  });

  it('(b) deliberate forward minor above publishedMax → used as-is (npm does not override intent)', () => {
    const plan = makePlan(allowlist, '2.1.0-alpha.0');
    const viewVersions = viewFrom({
      ['@scope/a']: ['2.0.0-alpha.6'],
      ['@scope/b']: ['2.0.0-alpha.6']
    });
    const res = resolveAlphaPublishVersion({ plan, viewVersions });
    expect(res.intended).toBe('2.1.0-alpha.0');
    expect(res.publishedMax).toBe('2.0.0-alpha.6');
    expect(res.resolved).toBe('2.1.0-alpha.0');
    expect(res.reason).toBe('intended-ahead');
  });

  it('(c) resolved candidate already taken → skips to the next free version', () => {
    const plan = makePlan(allowlist, '2.0.0-alpha.2');
    // alpha.7 is already taken by one package; the next fresh version is alpha.8.
    const viewVersions = viewFrom({
      ['@scope/a']: ['2.0.0-alpha.6', '2.0.0-alpha.7'],
      ['@scope/b']: ['2.0.0-alpha.5']
    });
    const res = resolveAlphaPublishVersion({ plan, viewVersions });
    expect(res.publishedMax).toBe('2.0.0-alpha.7');
    expect(res.resolved).toBe('2.0.0-alpha.8');
    // The resolved version must be fresh for EVERY allowlisted package.
    const publishedEverywhere = new Set([
      ...viewVersions('@scope/a'),
      ...viewVersions('@scope/b')
    ]);
    expect(publishedEverywhere.has(res.resolved)).toBe(false);
  });

  it('(d) nothing published anywhere → uses intended', () => {
    const plan = makePlan(allowlist, '2.0.0-alpha.0');
    const viewVersions = viewFrom({ ['@scope/a']: [], ['@scope/b']: [] });
    const res = resolveAlphaPublishVersion({ plan, viewVersions });
    expect(res.publishedMax).toBeNull();
    expect(res.resolved).toBe('2.0.0-alpha.0');
    expect(res.reason).toBe('nothing-published');
  });

  it('never resolves to an already-published version (core safety property)', () => {
    const plan = makePlan(allowlist, '2.0.0-alpha.3');
    const viewVersions = viewFrom({
      ['@scope/a']: ['2.0.0-alpha.3', '2.0.0-alpha.4', '2.0.0-alpha.6'],
      ['@scope/b']: ['2.0.0-alpha.5', '2.0.0-alpha.6']
    });
    const res = resolveAlphaPublishVersion({ plan, viewVersions });
    const all = new Set([...viewVersions('@scope/a'), ...viewVersions('@scope/b')]);
    expect(all.has(res.resolved)).toBe(false);
    expect(res.resolved).toBe('2.0.0-alpha.7');
  });
});
