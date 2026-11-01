import type { StyleImport, Stylesheet } from './ast/nodes.js';

/**
 * What each import a render evaluated resolved to: import → resolved path → the
 * document it loaded, or `null` when it stays a CSS `@import` as written; and
 * which imports a document's `processImports: false` policy skipped. Set as
 * `Context.importTargets` before a render; a converter reads it to point a
 * converted import at what the import resolved to in its own importer's context.
 */
export class ImportTargets extends Map<StyleImport, Map<string, Stylesheet | null>> {
  readonly skipped = new Set<StyleImport>();

  skip(node: StyleImport): void {
    this.skipped.add(node);
  }

  record(node: StyleImport, target: string, document: Stylesheet | null): void {
    let resolved = this.get(node);
    if (resolved === undefined) {
      this.set(node, resolved = new Map());
    }
    resolved.set(target, document);
  }
}
