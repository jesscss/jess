/**
 * The SCSS corpus reports are generated wholesale, and they also carry owner
 * rulings that a generator cannot reproduce. These tests pin the one property
 * that matters: regenerating preserves the hand-written tail exactly, and where
 * it cannot, it throws instead of writing.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  HAND_MAINTAINED_MARKER,
  handMaintainedTail,
  writeReportPreservingTail
} from './corpus-report-tail.js';

const OWNER_RULINGS = `${HAND_MAINTAINED_MARKER}

## Owner rulings on each blocker (2026-08-08)

| # | blocker | ruling |
| --- | --- | --- |
| 1 | keyword arg \`$name: v\` | **Real gap — OPEN.** |
| 3 | \`@error\` / \`@warn\` | **They do not become NODES.** |
`;

const body = (generated: string) => [
  '# Corpus report',
  '',
  `- Generated: \`${generated}\``,
  ''
].join('\n');

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'jess-corpus-report-'));
  file = path.join(dir, 'REPORT.md');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('corpus report hand-maintained tail', () => {
  it('preserves a hand-written tail across a regeneration, byte for byte', () => {
    writeFileSync(file, `${body('first')}\n${OWNER_RULINGS}`, 'utf8');

    writeReportPreservingTail(file, body('second'));

    const rewritten = readFileSync(file, 'utf8');
    expect(rewritten).toContain('- Generated: `second`');
    expect(rewritten).not.toContain('- Generated: `first`');
    expect(rewritten.slice(rewritten.indexOf(HAND_MAINTAINED_MARKER))).toBe(OWNER_RULINGS);
  });

  it('is stable under repeated regeneration', () => {
    writeFileSync(file, `${body('first')}\n${OWNER_RULINGS}`, 'utf8');

    writeReportPreservingTail(file, body('same'));
    const once = readFileSync(file, 'utf8');
    writeReportPreservingTail(file, body('same'));

    expect(readFileSync(file, 'utf8')).toBe(once);
  });

  it('creates a marked file when no report exists yet', () => {
    writeReportPreservingTail(file, body('first'));

    expect(readFileSync(file, 'utf8')).toBe(`${body('first').trimEnd()}\n\n${HAND_MAINTAINED_MARKER}\n`);
  });

  it('throws rather than overwriting a report that has no marker', () => {
    writeFileSync(file, `${body('first')}\n## Owner rulings\n\nDo not lose me.\n`, 'utf8');

    expect(() => writeReportPreservingTail(file, body('second')))
      .toThrow(/no hand-maintained marker/);
    expect(readFileSync(file, 'utf8')).toContain('Do not lose me.');
  });

  it('throws when the generated body itself contains the marker', () => {
    writeFileSync(file, `${body('first')}\n${OWNER_RULINGS}`, 'utf8');

    expect(() => writeReportPreservingTail(file, `${body('second')}\n${HAND_MAINTAINED_MARKER}\n`))
      .toThrow(/contains the hand-maintained marker/);
    expect(readFileSync(file, 'utf8')).toContain('- Generated: `first`');
  });

  it('reads the tail of a file that has a marker and nothing after it', () => {
    writeFileSync(file, `${body('first')}\n${HAND_MAINTAINED_MARKER}\n`, 'utf8');

    expect(handMaintainedTail(file)).toBe(`${HAND_MAINTAINED_MARKER}\n`);
  });
});

describe('the committed corpus reports carry the marker', () => {
  const here = path.dirname(new URL(import.meta.url).pathname);

  it.each(['CORPUS-REPORT.md', 'FOUNDATION-CORPUS-REPORT.md'])(
    '%s can be regenerated without losing its tail',
    (name) => {
      expect(readFileSync(path.join(here, name), 'utf8')).toContain(HAND_MAINTAINED_MARKER);
    }
  );
});
