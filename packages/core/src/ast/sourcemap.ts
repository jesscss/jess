import {
  GenMapping,
  maybeAddMapping,
  setSourceContent,
  toEncodedMap,
  type EncodedSourceMap
} from '@jridgewell/gen-mapping';
import { lineColAt } from '../error/code-frame.js';
import { sourceStartOf, NO_SPAN } from './provenance.js';
import type { Position } from './serialize.js';

/**
 * Source-map generation for the LIVE AST-v2 render path.
 *
 * The one existing emit walk records a dense {@link Position} stream: each entry
 * is a chunk's OUTPUT character range plus the node it came from (whose source
 * offset is `sourceStartOf(node)`) and the source FILE active at emit time. This
 * turns that stream into a v3 source map, closing the three gaps the serializer
 * left open:
 *   1. output offset -> {line,col}: one line-start index over the final CSS, then
 *      a binary search per position (never a per-position rescan);
 *   2. source offset -> {line,col}: the shared `lineColAt`, whose line-start
 *      index is cached per source file (keyed by the file object);
 *   3. per-position source-file identity: `Position.source`, stamped at each push
 *      from the active source owner, so imported files map to themselves.
 *
 * Granularity: one mapping at the start of each emitted node (selector header,
 * declaration, value, at-rule, statement), and one per line of an `(inline)`
 * import. Less 4.x writes one per emitted chunk instead, so the two maps differ
 * in bytes, not in where a token points. `sources` are normalized as Less
 * `normalizeFilename` does (basepath strip, then rootpath prefix);
 * `outputSourceFiles` embeds the content of each source a mapping names. Text a
 * host injected ahead of the entry file (`DocumentContextOptions.file.sourceOffset`)
 * has no authored position and is left unmapped. These three choices are ledger
 * row O12.
 */
export interface AstSourceMapOptions {
  /** Recorded as the map's `file` (the generated output filename). */
  outputFilename?: string;

  /** Prepended to every `source` after basepath removal (Less `sourceMapRootpath`). */
  sourceMapRootpath?: string;

  /** Stripped from the front of every source path (Less `sourceMapBasepath`). */
  sourceMapBasepath?: string;

  /** Embed each source file's content in `sourcesContent` (Less `outputSourceFiles`). */
  outputSourceFiles?: boolean;
}

/** One-pass line-start index over the generated CSS. */
function buildLineStarts(source: string): number[] {
  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source.charCodeAt(offset) === 10 /* \n */) {
      lineStarts.push(offset + 1);
    }
  }
  return lineStarts;
}

/** 1-based line, 0-based column at an output offset via binary search. */
function lineColFromIndex(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (lineStarts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { line: low + 1, column: offset - lineStarts[low]! };
}

/**
 * Less `removeBasepath`: strip a `/`-separated `basepath` prefix and the one
 * separator after it. Less applies it to every `source` and to the
 * `sourceMappingURL` annotation (`source-map-builder.js`).
 */
export function removeSourceMapBasepath(path: string, basepath: string | undefined): string {
  if (basepath === undefined || basepath === '' || path.indexOf(basepath) !== 0) {
    return path;
  }
  const rest = path.substring(basepath.length);
  return rest.charAt(0) === '/' || rest.charAt(0) === '\\' ? rest.substring(1) : rest;
}

/** Less `normalizeFilename`: basepath removal, then rootpath prefix (already `/`-terminated). */
function normalizeFilename(filename: string, rootpath: string, basepath: string | undefined): string {
  return rootpath + removeSourceMapBasepath(filename.replace(/\\/g, '/'), basepath);
}

/**
 * Build a v3 source map from the render's position stream and its generated CSS.
 * Positions with no resolvable source (no active file, no captured source text,
 * or an unspanned node) contribute no mapping — the map is still valid, just
 * sparser at those points.
 */
export function buildAstSourceMap(
  css: string,
  positions: Position[],
  options: AstSourceMapOptions = {}
): EncodedSourceMap {
  const genLineStarts = buildLineStarts(css);
  let rootpath = options.sourceMapRootpath?.replace(/\\/g, '/') ?? '';
  if (rootpath !== '' && !rootpath.endsWith('/')) {
    rootpath += '/';
  }
  const basepath = options.sourceMapBasepath?.replace(/\\/g, '/');
  const map = new GenMapping({ file: options.outputFilename });
  const contentAdded = new Set<string>();

  for (const position of positions) {
    /*
     * The document root is a whole-stylesheet anchor at output offset 0, not a
     * content chunk; emitting it would map the first output byte to the ENTRY
     * file's start even when that byte is spliced-in imported content, shadowing
     * the correct per-chunk mapping. Less 4.x emits no such anchor — skip it.
     * A chunk blanked after the walk (a dropped or hidden block) emitted
     * nothing, so it gets no mapping either.
     */
    if (position.type === 'Stylesheet' || position.start === position.end) {
      continue;
    }
    const file = position.source;
    const filename = file?.fullPath;
    const sourceText = file?.source;
    if (filename === undefined || sourceText === undefined) {
      continue;
    }
    const sourceOffset = position.sourceStart ?? sourceStartOf(position.node);
    const injected = file?.sourceOffset ?? 0;

    /* Nodes from text injected ahead of the file (Less `globalVars`) have no authored home. */
    if (sourceOffset === NO_SPAN || sourceOffset < injected) {
      continue;
    }
    const generated = lineColFromIndex(genLineStarts, position.start);
    const original = lineColAt(sourceText, sourceOffset, file);
    let line = original.line;
    let column = original.column - 1;
    if (injected > 0) {
      const origin = lineColAt(sourceText, injected, file);
      line -= origin.line - 1;
      column -= original.line === origin.line ? origin.column - 1 : 0;
    }
    const source = normalizeFilename(filename, rootpath, basepath);
    maybeAddMapping(map, {
      generated: { line: generated.line, column: generated.column },
      original: { line, column },
      source
    });
    if (options.outputSourceFiles === true && !contentAdded.has(source)) {
      contentAdded.add(source);
      setSourceContent(map, source, injected > 0 ? sourceText.slice(injected) : sourceText);
    }
  }

  return toEncodedMap(map);
}
