import { expect } from 'vitest';

// Set TEST environment variable for packages that depend on it
process.env.TEST = 'true';

expect.extend({
  /** Normalizes CSS-ish strings */
  toMatchCss(received: string, expected: string) {
    let replaceWS = (str: string) =>
      str.replace(/\s+/g, ' ').replace(/:\s*/g, ':').replace(/;/g, '');

    received = replaceWS(received);
    expected = replaceWS(expected);
    return {
      // do not alter your "pass" based on isNot. Vitest does it for you
      pass: received === expected,
      message: () => 'strings do not match',
      actual: received,
      expected
    };
  },
  toBeString(received: string, expected: string) {
    /**
     * This is how much space we can remove.
     * After a backtick, we count the space until
     * the first non-space value, which becomes the indent.
     *
     * This helps write string tests that are easier to read.
     */
    const indent = expected.match(/^\n(\s+)/);
    if (indent?.[1]) {
      expected = expected
        .replace(new RegExp(`\\n\\s{${indent[1].length}}`, 'gm'), '\n')
        .trim();
    }

    received = received.trim();

    return {
      // do not alter your "pass" based on isNot. Vitest does it for you
      pass: received === expected,
      message: () => 'strings do not match',
      actual: received,
      expected
    };
  },
  toContainString(received: string, expected: string) {
    // Normalize expected indent like toBeString
    const indent = expected.match(/^\n(\s+)/);
    if (indent?.[1]) {
      expected = expected.replace(new RegExp(`\n\s{${indent[1].length}}`, 'gm'), '\n').trim();
    } else {
      expected = expected.trim();
    }

    // Build a loose whitespace regex for matching without destroying indentation in the output
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const loose = escape(expected).replace(/\s+/g, '\\s+');
    const re = new RegExp(loose, 'm');
    const match = re.exec(received);
    const pass = Boolean(match);
    return {
      pass,
      message: () => this.utils.matcherHint(`${this.isNot ? '.not' : ''}.toContainString`),
      actual: received,
      expected
    };
  }
});