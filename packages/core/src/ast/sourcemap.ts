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
 * Mirrors Less 4.x `SourceMapOutput`/`SourceMapBuilder` shape: one mapping per
 * emitted chunk, `normalizeFilename` (basepath strip + rootpath prefix), and
 * `sourcesContent` under `outputSourceFiles`.
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

/** Less `normalizeFilename`: basepath removal, then rootpath prefix. */
function normalizeFilename(filename: string, rootpath: string, basepath: string | undefined): string {
  let path = filename.replace(/\\/g, '/');
  if (basepath !== undefined && basepath !== '' && path.indexOf(basepath) === 0) {
    path = path.substring(basepath.length);
    if (path.charAt(0) === '/' || path.charAt(0) === '\\') {
      path = path.substring(1);
    }
  }
  return rootpath + path;
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
  const rootpath = options.sourceMapRootpath ?? '';
  const basepath = options.sourceMapBasepath?.replace(/\\/g, '/');
  const map = new GenMapping({ file: options.outputFilename });
  const contentAdded = new Set<string>();

  for (const position of positions) {
    const file = position.source;
    const filename = file?.fullPath;
    const sourceText = file?.source;
    if (filename === undefined || sourceText === undefined) {
      continue;
    }
    const sourceOffset = sourceStartOf(position.node);
    if (sourceOffset === NO_SPAN) {
      continue;
    }
    const generated = lineColFromIndex(genLineStarts, position.start);
    const original = lineColAt(sourceText, sourceOffset, file);
    const source = normalizeFilename(filename, rootpath, basepath);
    maybeAddMapping(map, {
      generated: { line: generated.line, column: generated.column },
      original: { line: original.line, column: original.column - 1 },
      source
    });
    if (options.outputSourceFiles === true && !contentAdded.has(source)) {
      contentAdded.add(source);
      setSourceContent(map, source, sourceText);
    }
  }

  return toEncodedMap(map);
}
