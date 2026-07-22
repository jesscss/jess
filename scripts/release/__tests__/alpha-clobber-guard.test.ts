import { describe, it, expect } from 'vitest';
// The release tooling is plain ESM (.mjs); import it directly.
import { computeMinAlphaTag, isAlphaClobber } from '../release-utils.mjs';

/**
 * Turn a map of pkg -> current `alpha` dist-tag version into an injectable
 * `getTagged`. A missing entry (undefined) models a package with no alpha tag
 * yet (unpublished / fresh) -- never hits the real registry.
 */
function taggedFrom(tags: Record<string, string | null>) {
  return (pkg: string): string | null => tags[pkg] ?? null;
}

const pkgs = ['@scope/a', '@scope/b', '@scope/c'];

describe('computeMinAlphaTag (laggard across the publish set)', () => {
  it('returns the minimum alpha number, comparing numerically', () => {
    expect(
      computeMinAlphaTag(
        pkgs,
        taggedFrom({
          ['@scope/a']: '2.0.0-alpha.8',
          ['@scope/b']: '2.0.0-alpha.10',
          ['@scope/c']: '2.0.0-alpha.9'
        })
      )
    ).toBe('2.0.0-alpha.8');
  });

  it('ignores packages with no alpha tag (they do not drag the min down)', () => {
    expect(
      computeMinAlphaTag(
        pkgs,
        taggedFrom({
          ['@scope/a']: '2.0.0-alpha.8',
          ['@scope/b']: null,
          ['@scope/c']: '2.0.0-alpha.9'
        })
      )
    ).toBe('2.0.0-alpha.8');
  });

  it('returns null when NO package has an alpha tag', () => {
    expect(computeMinAlphaTag(pkgs, taggedFrom({}))).toBeNull();
  });
});

describe('isAlphaClobber (dev->alpha squash guard)', () => {
  // Helper mirroring the publish-alpha.mjs call site: compute minTag from the
  // per-package tags, then run the guard against the branch manifest version.
  function guard(manifestVersion: string, tags: Record<string, string | null>) {
    const minTag = computeMinAlphaTag(pkgs, taggedFrom(tags));
    return isAlphaClobber({ manifestVersion, minTag });
  }

  const allEight = {
    ['@scope/a']: '2.0.0-alpha.8',
    ['@scope/b']: '2.0.0-alpha.8',
    ['@scope/c']: '2.0.0-alpha.8'
  };

  it('(a) manifest alpha.5, all tags alpha.8 -> REFUSE (clobbered below published)', () => {
    expect(guard('2.0.0-alpha.5', allEight)).toBe(true);
  });

  it('(b) manifest alpha.8, all tags alpha.8 -> REFUSE (already released, needs bump)', () => {
    expect(guard('2.0.0-alpha.8', allEight)).toBe(true);
  });

  it('(c) manifest alpha.8, tags {alpha.8, alpha.8, alpha.7 laggard} -> ALLOW (resume)', () => {
    expect(
      guard('2.0.0-alpha.8', {
        ['@scope/a']: '2.0.0-alpha.8',
        ['@scope/b']: '2.0.0-alpha.8',
        ['@scope/c']: '2.0.0-alpha.7'
      })
    ).toBe(false);
  });

  it('(d) preflight candidate alpha.9, all tags alpha.8 -> ALLOW (fresh bump ahead)', () => {
    expect(guard('2.0.0-alpha.9', allEight)).toBe(false);
  });

  it('(e) no package has an alpha tag -> ALLOW (fresh package set)', () => {
    expect(guard('2.0.0-alpha.0', {})).toBe(false);
  });

  it('(f) different base: manifest 2.1.0-alpha.1 vs tags 2.0.0-alpha.8 -> ALLOW (real bump)', () => {
    expect(guard('2.1.0-alpha.1', allEight)).toBe(false);
  });

  it('numeric (not lexical) alpha comparison: manifest alpha.10 vs tags alpha.9 -> ALLOW', () => {
    expect(
      guard('2.0.0-alpha.10', {
        ['@scope/a']: '2.0.0-alpha.9',
        ['@scope/b']: '2.0.0-alpha.9',
        ['@scope/c']: '2.0.0-alpha.9'
      })
    ).toBe(false);
  });

  it('a stable (non-alpha) manifest version never flags', () => {
    expect(isAlphaClobber({ manifestVersion: '2.0.0', minTag: '2.0.0-alpha.8' })).toBe(false);
  });
});
