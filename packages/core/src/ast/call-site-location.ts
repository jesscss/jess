import type { Context } from '../context.js';
import { INJECTED_TEXT_NOTE, fileAt, lineColAt } from '../error/code-frame.js';
import type { TreeContextLike } from '../error/jess-error.js';
import { sourceSpanOf } from './provenance.js';

type SiteLocation = { ctx: TreeContextLike; line?: number; column?: number; note?: string };

/**
 * Source position of a node, for a diagnostic that points at it. The diagnostic
 * keeps the file object, which says where the authored file sits in the parsed
 * text, so its code frame counts lines as `lineColAt` does (ledger O16). A node
 * in text the host injected around the file is counted in the prepared text and
 * says so ({@link fileAt}).
 */
function locationIn(authored: TreeContextLike['file'], node: object): SiteLocation {
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
 * Where an error points. A span means something only in the file that wrote it,
 * and the document a lane is in need not be that file: a function's `@return` is
 * read on its caller's lane, and a scratch session has no `context` at all. So the
 * file comes from the node ({@link Context.fileOfNode}). A node no document holds,
 * because evaluation built it, is read in the lane's document, and on a scratch
 * session in none.
 */
export function callSiteLocation(node: object, s: { readonly context: Context | undefined; readonly locating?: Context | undefined }): SiteLocation {
  return locationIn((s.context ?? s.locating)?.fileOfNode(node) ?? s.context?.sourceContext?.file, node);
}

/**
 * Where a warning points: the node's span in the lane's document. A compile that
 * warns goes on, so a warning doesn't pay for {@link callSiteLocation}'s walk of
 * each document. It can name the lane's file for a value read from another one.
 */
export function laneSiteLocation(node: object, s: { readonly context: Context | undefined }): SiteLocation {
  return locationIn(s.context?.sourceContext?.file, node);
}
