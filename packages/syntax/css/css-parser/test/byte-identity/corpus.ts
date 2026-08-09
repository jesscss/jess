/**
 * The two corpora the CSS byte-identity oracle measures.
 *
 * ## `authored` — the literal channel
 *
 * Hand-written CSS in the exact form `serialize` emits, one file per construct
 * axis. The input IS the expected output, so these assert the strongest
 * property available: an author's file round-trips byte for byte, trivia
 * included. The set is NAMED (`AUTHORED_FILES`) rather than globbed, because a
 * ratchet keyed on a count cannot tell "a file was added" from "a file silently
 * dropped out"; the loader throws if a named file is missing and throws again
 * if the directory holds a `.css` the list does not name.
 *
 * ## `emitted` — the breadth channel
 *
 * Real-world stylesheets are not written in jess's canonical form, so they
 * cannot be the input side of a literal test — and normalizing them until they
 * could would be bending the oracle until it passes. Instead each real file is
 * run through the parser once and its OUTPUT becomes the corpus entry: that
 * output is real CSS, derived from Bootstrap and from every in-tree stylesheet,
 * and the oracle then asks the same unmodified question of it. This is the
 * emit-is-a-fixed-point property. It needs no baseline and no normalization,
 * and it carries the breadth the hand-written half cannot.
 *
 * The real-world file list comes from `render-differential/corpus.mjs` — shared
 * deliberately. Two corpus builders over the same stylesheets would drift, and
 * the render differential's builder already throws on a missing root, an
 * unresolvable Bootstrap, or an empty bucket.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusEntry } from './oracle.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, 'fixtures');

/**
 * The named authored set. Every entry is a construct axis, and the name says
 * which. Adding a file here without adding it to `fixtures/` is a hard error,
 * and so is the reverse — the list and the directory must agree exactly.
 */
export const AUTHORED_FILES: readonly string[] = [
  'at-rule-charset-then-import.css',
  'at-rules-conditional.css',
  'at-rules-import-namespace.css',
  'at-rules-keyframes-fontface.css',
  'at-rules-statement.css',
  'comments-positions.css',
  'custom-properties.css',
  'declarations-edges.css',
  'empty-blocks.css',
  'nesting-ampersand.css',
  'nesting-at-rule-inside-rule.css',
  'nesting-ident-start-ambiguity.css',
  'nesting-qualified-rule.css',
  'selector-attribute-case-flag.css',
  'selectors-full.css',
  'value-slash-separator.css',
  'values-full.css'
];

export function loadAuthoredCorpus(): CorpusEntry[] {
  const onDisk = readdirSync(FIXTURE_DIR).filter(name => name.toLowerCase().endsWith('.css')).sort();
  const named = [...AUTHORED_FILES].sort();

  const missing = named.filter(name => !onDisk.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `css byte-identity: named authored fixture(s) missing from disk: ${missing.join(', ')}. `
      + 'A named set that silently shrinks is how an oracle reports a confident wrong answer.'
    );
  }
  const unnamed = onDisk.filter(name => !named.includes(name));
  if (unnamed.length > 0) {
    throw new Error(
      `css byte-identity: fixture(s) on disk are not in AUTHORED_FILES: ${unnamed.join(', ')}. `
      + 'Name them or delete them — an unnamed fixture is outside the ratchet.'
    );
  }

  return named.map(name => ({
    id: `authored/${name}`,
    source: readFileSync(join(FIXTURE_DIR, name), 'utf8')
  }));
}

/**
 * Build the emitted corpus by running every real-world stylesheet through the
 * supplied surface once. Files the grammar REJECTS are excluded here rather
 * than counted as round-trip failures: the render-differential corpus contains
 * 56 deliberate rejects (`errors/`, `calc-rejects.css`), and folding a
 * deliberate rejection into a byte-identity failure would report the grammar's
 * contract as a defect. The rejected count is returned so the number is visible
 * instead of implied.
 */
export async function loadEmittedCorpus(
  files: readonly { id: string; source: string }[],
  emit: (source: string) => Promise<string>
): Promise<{ entries: CorpusEntry[]; rejected: string[] }> {
  const entries: CorpusEntry[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    try {
      entries.push({ id: `emitted/${file.id}`, source: await emit(file.source) });
    } catch {
      rejected.push(file.id);
    }
  }
  return { entries, rejected };
}
