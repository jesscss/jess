import {
  GenMapping,
  addMapping,
  setSourceContent,
  toEncodedMap
} from '@jridgewell/gen-mapping';
import type { OutputWriter, SourceSegment } from './print.js';

export type BuildSourceMapOptions = {
  file?: string;
  sourcesContent?: Map<string, string>;
};

export function buildSourceMap(writer: OutputWriter, opts: BuildSourceMapOptions = {}) {
  const map = new GenMapping({ file: opts.file });
  const segs: SourceSegment[] = writer.getSegments();

  for (const s of segs) {
    if (s.source) {
      addMapping(map, {
        generated: { line: s.genLine + 1, column: s.genColumn },
        source: s.source,
        original: { line: s.origLine + 1, column: s.origColumn }
      });
      const content = opts.sourcesContent?.get(s.source);
      if (content !== undefined) setSourceContent(map, s.source, content);
    } else {
      addMapping(map, {
        generated: { line: s.genLine + 1, column: s.genColumn }
      });
    }
  }

  return toEncodedMap(map);
}
