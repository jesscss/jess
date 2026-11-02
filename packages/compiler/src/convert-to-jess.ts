import * as fs from 'node:fs';
import * as path from 'path';
import { type Context, type ImportTargets, emitJess, NoJessSpelling } from '@jesscss/core';
import type { AtRuleStatement, StyleImport, Stylesheet } from '@jesscss/core/ast';
import { type ConvertedFile, jessPathOf } from './sandbox-route.js';

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
  loads: ImportTargets,
  overwrite = false
): ConvertedFile[] {
  const documents = loadedDocuments(context, entry, loads);
  const { converted, unwritable } = claimTargets(context, documents, overwrite);
  const files: ConvertedFile[] = [];
  for (const [document, source] of documents) {
    const functions = converted.has(document) ? context.pluginOf(document)?.jessFunctions?.() : undefined;
    if (functions === undefined) {
      continue;
    }
    const jessPath = jessPathOf(source);
    const unwritten = unwritable.get(document);
    if (unwritten !== undefined) {
      files.push({ source, jessPath, gaps: [{ nodeType: 'Stylesheet', reason: `its \`.jess\` path cannot be written: ${unwritten}` }] });
      continue;
    }
    try {
      const importPath = importPathFrom(source, loads, converted, unwritable);
      files.push({ source, jessPath, jess: emitJess(document, { functions, importPath, preludeImport: preludeImportOf(loads, document === entry) }) });
    } catch (error) {
      if (!(error instanceof NoJessSpelling)) {
        throw error;
      }
      files.push({ source, jessPath, gaps: error.gaps });
    }
  }
  return files;
}

/**
 * Which documents convert, by document, not path (a `(less)` import and a CSS
 * import of one file are two documents), and why each that cannot have its
 * `.jess` path written cannot: another converted file of this render takes the
 * path first; it is a symlink, or a hard-linked file (a pnpm store file, which
 * other projects share); it exists and `overwrite` is not set; or, with
 * `overwrite`, it is the same file (`dev` and `ino`) as a document the render
 * loaded, however its path is spelled. A document that cannot be written, and
 * every import of it, is a gap.
 */
function claimTargets(
  context: Context,
  documents: ReadonlyMap<Stylesheet, string>,
  overwrite: boolean
): { converted: Set<Stylesheet>; unwritable: Map<Stylesheet, string> } {
  const converted = new Set<Stylesheet>();
  const unwritable = new Map<Stylesheet, string>();
  const claimed = new Set<string>();
  let loaded: Set<string> | undefined;
  for (const [document, source] of documents) {
    if (!path.isAbsolute(source) || context.pluginOf(document)?.jessFunctions === undefined) {
      continue;
    }
    converted.add(document);
    const jessPath = jessPathOf(source);
    const existing = fs.lstatSync(jessPath, { throwIfNoEntry: false });
    const reason = claimed.has(jessPath)
      ? 'another converted file of this render writes it'
      : existing?.isSymbolicLink() === true
        ? 'it is a symlink'
        : existing !== undefined && existing.nlink > 1
          ? 'it is a hard-linked file (writing it would change every other link to it)'
          : existing !== undefined && !overwrite
            ? 'it would overwrite an existing file (pass `overwrite: true` to replace it)'
            : existing !== undefined && (loaded ??= fileIdentities(documents.values())).has(`${existing.dev}:${existing.ino}`)
              ? 'it is a file this render loaded'
              : undefined;
    if (reason !== undefined) {
      unwritable.set(document, reason);
    }
    claimed.add(jessPath);
  }
  return { converted, unwritable };
}

/** Each file's `dev:ino`, so two spellings of one file compare equal. */
const fileIdentities = (files: Iterable<string>): Set<string> => new Set([...files].flatMap((file) => {
  const stat = path.isAbsolute(file) ? fs.statSync(file, { throwIfNoEntry: false }) : undefined;
  return stat === undefined ? [] : [`${stat.dev}:${stat.ino}`];
}));

/** The entry and every document the render loaded, each with its source path, in load order. */
function loadedDocuments(context: Context, entry: Stylesheet, loads: ImportTargets): Map<Stylesheet, string> {
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
  return documents;
}

/** Each import of the document at `source`, as the path of what it resolved to (`EmitJessOptions.importPath`). */
function importPathFrom(
  source: string,
  loads: ImportTargets,
  converted: ReadonlySet<Stylesheet>,
  unwritable: ReadonlyMap<Stylesheet, string>
): (authored: string, node: StyleImport) => string | null {
  return (_authored, node) => {
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
    const unwritten = unwritable.get(loadedDocument);
    if (unwritten !== undefined) {
      throw new NoJessSpelling('StyleImport', `an import of a file whose \`.jess\` path cannot be written: ${unwritten}`);
    }
    if (!path.isAbsolute(target)) {
      return target;
    }
    const relative = path.relative(path.dirname(source), converted.has(loadedDocument) ? jessPathOf(target) : target)
      .split(path.sep).join('/');
    return relative.startsWith('../') ? relative : `./${relative}`;
  };
}

/**
 * Where the render wrote each root CSS `@import` (`EmitJessOptions.preludeImport`).
 * The output prelude takes those of the entry and of every file it imports, in
 * import order (ledger N9); a `.jess` CSS `@import` is written where it stands,
 * so the entry's can lead its `.jess`, and an imported file's is a gap.
 */
function preludeImportOf(loads: ImportTargets, isEntry: boolean): (node: AtRuleStatement) => 'first' | 'dropped' | null {
  return (node) => {
    const written = loads.hoisted.get(node);
    if (written !== undefined && !isEntry) {
      throw new NoJessSpelling('AtRuleStatement', 'a CSS `@import` the render moved from an imported file into the output prelude: a `.jess` CSS `@import` is written where its file is imported');
    }
    return written === undefined ? null : written ? 'first' : 'dropped';
  };
}
