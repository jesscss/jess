/**
 * Hand-maintained tails in the generated SCSS corpus reports.
 *
 * `JESS_SCSS_CORPUS_REPORT=1` rewrites CORPUS-REPORT.md and
 * FOUNDATION-CORPUS-REPORT.md wholesale. Those files also carry owner rulings —
 * prose that no generator can reproduce and that an active lane works from.
 * Twice the regeneration deleted them, and both times they came back out of git;
 * the second repair added a warning banner, which does not help the next agent
 * who regenerates before reading.
 *
 * The mechanism is a SENTINEL the generator never writes past. It is preferred
 * over the alternatives for one reason: it cannot fail silently.
 *
 *   - a separate hand-written file that the report links to still leaves the
 *     generated file writable in full, so nothing stops the next author from
 *     putting a ruling back at the bottom of the report where it will be lost;
 *   - "read the old file and re-append whatever looked hand-written" has to
 *     GUESS where the generated part ends, and a wrong guess is silent.
 *
 * A sentinel makes the boundary explicit and machine-checkable, so the failure
 * modes become loud errors: writing a report whose file exists but has no
 * sentinel throws, and so does a generated body that contains one.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * The boundary. Everything from this line to end-of-file is copied through
 * byte-for-byte; the generator owns only what is above it.
 */
export const HAND_MAINTAINED_MARKER =
  '<!-- HAND-MAINTAINED BELOW — the generator never writes past this line. -->';

/** Body a brand-new report file gets below the marker. */
const EMPTY_TAIL = `${HAND_MAINTAINED_MARKER}\n`;

/**
 * The verbatim tail of an existing report, marker included.
 *
 * Throws when the file exists without a marker: that is either a report written
 * before this mechanism existed or one whose marker was edited away, and in
 * both cases continuing would destroy whatever is below the generated content.
 */
export function handMaintainedTail(file: string): string {
  if (!existsSync(file)) {
    return EMPTY_TAIL;
  }
  const existing = readFileSync(file, 'utf8');
  const at = existing.indexOf(HAND_MAINTAINED_MARKER);
  if (at < 0) {
    throw new Error(
      `${file} has no hand-maintained marker, so regenerating it would overwrite the whole file.\n`
      + 'Append this line to the file — directly above any hand-written section, or at the\n'
      + `end if there is none — and re-run:\n\n${HAND_MAINTAINED_MARKER}\n`
    );
  }
  return existing.slice(at);
}

/**
 * Write a generated report, preserving the hand-maintained tail of the file
 * that is already there.
 */
export function writeReportPreservingTail(file: string, generatedBody: string): void {
  if (generatedBody.includes(HAND_MAINTAINED_MARKER)) {
    throw new Error(
      `Generated report body for ${file} contains the hand-maintained marker.\n`
      + 'The marker must be written only by this module, or the boundary between\n'
      + 'generated and hand-written content stops being well defined.'
    );
  }
  const tail = handMaintainedTail(file);
  writeFileSync(file, `${generatedBody.replace(/\s+$/, '')}\n\n${tail}`, 'utf8');
}
