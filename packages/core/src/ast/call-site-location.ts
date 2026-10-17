import type { Context } from '../context.js';
import { INJECTED_TEXT_NOTE, fileAt, lineColAt } from '../error/code-frame.js';
import type { TreeContextLike } from '../error/jess-error.js';
import { sourceSpanOf } from './provenance.js';

/**
 * Source position of a node, for a diagnostic that points at it. The diagnostic
 * keeps the file object, which says where the authored file sits in the parsed
 * text, so its code frame counts lines as `lineColAt` does (ledger O16). A node
 * in text the host injected around the file is counted in the prepared text and
 * says so ({@link fileAt}).
 */
export function callSiteLocation(node: object, s: { readonly context: Context | undefined }): { ctx: TreeContextLike; line?: number; column?: number; note?: string } {
  const authored = s.context?.sourceContext?.file;
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
