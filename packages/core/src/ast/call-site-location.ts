import type { Context } from '../context.js';
import { INJECTED_TEXT_NOTE, fileAt, lineColAt } from '../error/code-frame.js';
import type { TreeContextLike } from '../error/jess-error.js';
import { sourceSpanOf } from './provenance.js';

/**
 * Source position of a node, for a diagnostic that points at it. The diagnostic
 * keeps the file object, which says where the authored file sits in the parsed
 * text, so its code frame counts lines as `lineColAt` does (ledger O16). A node
 * in text the host injected around the file is counted in the prepared text and
 * says so ({@link fileAt}). A scratch session has no `context` of its own, only
 * the render's, kept as `locating`.
 */
export function callSiteLocation(node: object, s: { readonly context: Context | undefined; readonly locating?: Context | undefined }): { ctx: TreeContextLike; line?: number; column?: number; note?: string } {
  const authored = (s.context ?? s.locating)?.sourceContext?.file;
  const source = authored?.source;
  const span = source === undefined ? undefined : sourceSpanOf(node);
  if (source === undefined || span === undefined) {
    return { ctx: { file: authored } };
  }
  const file = fileAt(authored!, source, span.start);
  const location = lineColAt(source, span.start, file);
  return file === authored
    ? { ctx: { file }, line: location.line, column: location.column }
    : { ctx: { file }, line: location.line, column: location.column, note: INJECTED_TEXT_NOTE };
}

/**
 * Run a function's body in the file that wrote it, as an error in the body counts
 * its lines in that file. The body runs on a scratch lane, which never enters a
 * document, so this enters it on the render's Context. `body` is the value a
 * document recorded; `fallback` is the owner of the frame it was defined in.
 */
export function whileLocatingIn(locating: Context | undefined, body: object, fallback: object | null, run: () => unknown): void {
  if (locating === undefined) {
    run();
  } else {
    void locating.withSourceOwner(locating.bodyOwner(body) ?? fallback, run);
  }
}
