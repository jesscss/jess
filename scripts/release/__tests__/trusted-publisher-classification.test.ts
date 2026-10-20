import { describe, it, expect } from 'vitest';

// The release tooling is plain ESM (.mjs); import it directly.
import { classifyTrustResult } from '../release-utils.mjs';

describe('classifyTrustResult (release:alpha:trust is idempotent)', () => {
  it('a successful registration is registered', () => {
    expect(classifyTrustResult({ published: true, status: 0, output: '' })).toBe('registered');
  });

  it('E409 (configuration already exists) counts as already registered, not a failure', () => {
    const output = 'npm error code E409\n'
      + 'npm error 409 Conflict - a trusted publisher configuration for this package already exists\n';
    expect(classifyTrustResult({ published: true, status: 1, output })).toBe('already-registered');
  });

  it('a package not on npm yet needs a first manual publish', () => {
    expect(classifyTrustResult({ published: false, status: null })).toBe('needs-first-publish');
  });

  it('any other error is a failure', () => {
    const output = 'npm error code E403\nnpm error 403 Forbidden\n';
    expect(classifyTrustResult({ published: true, status: 1, output })).toBe('failed');
  });
});
