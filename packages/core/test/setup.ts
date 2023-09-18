import { expect } from 'vitest'

expect.extend({
  toBeString(received: string, expected: string) {
    /**
     * This is how much space we can remove.
     * After a backtick, we count the space until
     * the first non-space value, which becomes the indent.
     *
     * This helps write string tests that are easier to read.
     */
    const indent = expected.match(/^\n(\s+)/)
    if (indent?.[1]) {
      expected = expected
        .replace(new RegExp(`\\n\\s{${indent[1].length}}`, 'gm'), '\n')
        .trim()
    }
    received = received.trim()
    return {
      // do not alter your "pass" based on isNot. Vitest does it for you
      pass: received === expected,
      message: () => 'strings do not match',
      actual: received,
      expected
    }
  }
})