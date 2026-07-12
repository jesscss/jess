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
  /**
   * Checks if the normalized expected string is contained within the normalized received string.
   *
   * Normalization: Both strings are normalized by removing the common leading whitespace
   * (determined by the first line after the initial newline in the expected string).
   *
   * When the test fails, returns aligned strings for diff display with the following requirements:
   *
   * 1. The first matching line (first non-empty line of expected found in received) starts at 0 spaces.
   * 2. All lines before the match preserve their relative indentation structure, normalized so the
   *    first non-empty line before the match starts at 0 spaces (or maintains relative indent if
   *    there are lines before it).
   * 3. All matching lines (both actual and expected) start at 0 spaces for the first line,
   *    with subsequent lines preserving relative indentation from the first matching line.
   * 4. All lines after the match preserve their relative indentation structure, normalized relative
   *    to the first matching line (so they maintain their original relative position).
   * 5. Both actual and expected strings have identical structure: [before] + [matching] + [after],
   *    where [before] and [after] come from received, and [matching] comes from received (actual)
   *    or expected (expected).
   *
   * The goal is that matching lines appear grey in the diff (no whitespace differences), and only
   * content differences are highlighted.
   */
  toContainString(received: string, expected: string) {
    // Helper: Normalize string by removing common leading whitespace
    const normalizeForComparison = (str: string): string => {
      const indentMatch = str.match(/^\n(\s+)/);
      if (indentMatch?.[1]) {
        const indentSize = indentMatch[1].length;
        return str.replace(new RegExp(`\\n\\s{${indentSize}}`, 'gm'), '\n').trim();
      }
      return str.trim();
    };

    const normalizedExpected = normalizeForComparison(expected);
    const normalizedReceived = normalizeForComparison(received);

    // Check if normalized expected is contained in normalized received
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = escape(normalizedExpected).replace(/\s+/g, '\\s+');
    const regex = new RegExp(pattern, 'm');
    const pass = regex.test(normalizedReceived);

    if (pass) {
      return {
        pass: true,
        message: () => this.utils.matcherHint(`${this.isNot ? '.not' : ''}.toContainString`),
        actual: received,
        expected: expected
      };
    }

    // Test failed - prepare aligned strings for diff
    const expectedFirstLine = normalizedExpected.split('\n')[0]?.trim();
    if (!expectedFirstLine) {
      return {
        pass: false,
        message: () => this.utils.matcherHint(`${this.isNot ? '.not' : ''}.toContainString`),
        actual: received,
        expected: expected
      };
    }

    // Find matching line index in normalized received
    const normalizedReceivedLines = normalizedReceived.split('\n');
    let matchIndex = -1;
    for (let i = 0; i < normalizedReceivedLines.length; i++) {
      if (normalizedReceivedLines[i]?.trim() === expectedFirstLine) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex < 0) {
      return {
        pass: false,
        message: () => this.utils.matcherHint(`${this.isNot ? '.not' : ''}.toContainString`),
        actual: received,
        expected: expected
      };
    }

    // Get original lines (preserving whitespace)
    const receivedLines = received.split('\n');
    const expectedLines = expected.split('\n');
    const expectedNonEmpty = expectedLines.filter(l => l.trim().length > 0);
    const expectedNonEmptyCount = expectedNonEmpty.length;

    // Split received into: before | matching | after
    const before = receivedLines.slice(0, matchIndex);
    const matching = receivedLines.slice(matchIndex, matchIndex + expectedNonEmptyCount);
    const after = receivedLines.slice(matchIndex + expectedNonEmptyCount);

    // Find first non-empty matching line's indent (our primary reference)
    let firstMatchingIndent = 0;
    for (const line of matching) {
      if (line.trim().length > 0) {
        const m = line.match(/^(\s*)/);
        firstMatchingIndent = m?.[1]?.length || 0;
        break;
      }
    }

    // Helper: Normalize lines relative to a reference indent
    const reindent = (lines: string[], refIndent: number): string[] => {
      return lines.map((line) => {
        if (line.trim().length === 0) {
          return line;
        }
        const m = line.match(/^(\s*)/);
        const lineIndent = m?.[1]?.length || 0;
        const relative = lineIndent - refIndent;
        const newIndent = ' '.repeat(Math.max(0, relative));
        return newIndent + line.trimStart();
      });
    };

    // Normalize each section:
    // - before: relative to its own first non-empty line (so first non-empty = 0)
    // - matching: relative to first matching line (so first matching = 0)
    // - after: relative to first matching line (maintains relative position)
    let beforeRef = 0;
    for (const line of before) {
      if (line.trim().length > 0) {
        const m = line.match(/^(\s*)/);
        beforeRef = m?.[1]?.length || 0;
        break;
      }
    }

    const normalizedBefore = reindent(before, beforeRef);
    const normalizedMatching = reindent(matching, firstMatchingIndent);
    const normalizedAfter = reindent(after, firstMatchingIndent);

    // Normalize expected relative to its first non-empty line
    const firstExpectedIndent = expectedNonEmpty[0]?.match(/^(\s*)/)?.[1]?.length || 0;
    const normalizedExpectedLines = reindent(expectedNonEmpty, firstExpectedIndent);

    // Construct final strings
    const alignedActual = [...normalizedBefore, ...normalizedMatching, ...normalizedAfter].join('\n');
    const alignedExpected = [...normalizedBefore, ...normalizedExpectedLines, ...normalizedAfter].join('\n');

    return {
      pass: false,
      message: () => this.utils.matcherHint(`${this.isNot ? '.not' : ''}.toContainString`),
      actual: alignedActual,
      expected: alignedExpected
    };
  }
});
