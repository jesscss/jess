import type { StyleImport, Stylesheet } from './ast/nodes.js';
import type { AtRuleStatement } from './ast/at-rule.js';

/**
 * What each import a render evaluated resolved to: import → resolved path → the
 * document it loaded, or `null` when it stays a CSS `@import` as written; and
 * which imports a document's `processImports: false` policy skipped; and which
 * root CSS `@import` statements the output prelude took (ledger N9). Set as
 * `Context.importTargets` before a render; a converter reads it to point a
 * converted import at what the import resolved to in its own importer's context.
 */
export class ImportTargets extends Map<StyleImport, Map<string, Stylesheet | null>> {
  readonly skipped = new Set<StyleImport>();

  /** A CSS `@import` the render moved into the output prelude: `true` written there, `false` dropped as a duplicate. */
  readonly hoisted = new Map<AtRuleStatement, boolean>();

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

  /** Records a CSS `@import` the prelude reached, at its first placement; whether it was dropped (`slot` is `undefined`). */
  hoist(node: AtRuleStatement, slot: number | undefined): boolean {
    if (!this.hoisted.has(node)) {
      this.hoisted.set(node, slot !== undefined);
    }
    return slot === undefined;
  }
}
