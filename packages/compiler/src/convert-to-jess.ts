import * as path from 'path';
import { type Context, type ImportTargets, emitJess, NoJessSpelling } from '@jesscss/core';
import type { StyleImport, Stylesheet } from '@jesscss/core/ast';
import type { ConvertedFile } from './sandbox-route.js';

const jessPathOf = (source: string): string => `${source.slice(0, source.length - path.extname(source).length)}.jess`;

/**
 * Print `entry` and every document its render loaded as `.jess`, after a render
 * that recorded `loads` (`Context.importTargets`). Each document gets its own
 * plugin's function module, and each import names what it resolved to: a
 * package, search-path or extension-inferred import, and an `@compose
 * "foo.less"`, all become the relative path of that file's `.jess`. An import
 * that stays a CSS `@import` is written as authored. No path is inferred from
 * the specifier: an import the render never resolved, or one that resolved to
 * more than one file, is a gap. A document whose plugin has no `jessFunctions`
 * (a `.css` or `.jess` file), or that is not a local file (a remote import), is
 * not converted, and an import of it names it as it is.
 */
export function printConversion(
  context: Context,
  entry: Stylesheet,
  loads: ImportTargets
): ConvertedFile[] {
  const documents = new Map<Stylesheet, string>();
  for (const [source, document] of context.sourceTrees) {
    if (document === entry) {
      documents.set(entry, source);
    }
  }
  for (const loaded of loads.values()) {
    for (const [source, document] of loaded) {
      if (document !== null) {
        documents.set(document, source);
      }
    }
  }

  /* By document, not path: a `(less)` import and a CSS import of one file are two documents. */
  const converted = new Set([...documents].flatMap(([document, source]) =>
    (path.isAbsolute(source) && context.pluginOf(document)?.jessFunctions !== undefined ? [document] : [])));
  const files: ConvertedFile[] = [];
  const written = new Set<string>();
  for (const [document, source] of documents) {
    const functions = converted.has(document) ? context.pluginOf(document)?.jessFunctions?.() : undefined;
    if (functions === undefined) {
      continue;
    }
    const importPath = (_authored: string, node: StyleImport): string | null => {
      if (loads.skipped.has(node)) {
        throw new NoJessSpelling('StyleImport', 'an import its document\'s `processImports: false` policy skipped: a `.jess` import has no such policy');
      }
      const loaded = loads.get(node);
      if (loaded === undefined) {
        throw new NoJessSpelling('StyleImport', 'an import the render never resolved: a `.jess` import names the file it resolves to');
      }
      const [resolved, ...others] = loaded;
      if (resolved === undefined || others.length > 0) {
        throw new NoJessSpelling('StyleImport', 'an import that resolved to more than one file: a `.jess` import names one');
      }
      const [target, loadedDocument] = resolved;
      if (loadedDocument === null) {
        return null;
      }
      if (!path.isAbsolute(target)) {
        return target;
      }
      const relative = path.relative(path.dirname(source), converted.has(loadedDocument) ? jessPathOf(target) : target)
        .split(path.sep).join('/');
      return relative.startsWith('../') ? relative : `./${relative}`;
    };
    const jessPath = jessPathOf(source);
    if (written.has(jessPath)) {
      files.push({ source, jessPath, gaps: [{ nodeType: 'Stylesheet', reason: 'another converted document of this render writes the same `.jess` file' }] });
      continue;
    }
    written.add(jessPath);
    try {
      files.push({ source, jessPath, jess: emitJess(document, { functions, importPath }) });
    } catch (error) {
      if (!(error instanceof NoJessSpelling)) {
        throw error;
      }
      files.push({ source, jessPath, gaps: error.gaps });
    }
  }
  return files;
}
