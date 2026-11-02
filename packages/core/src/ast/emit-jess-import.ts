import type { Statement, StyleImport, ValueNode, VariableDeclaration } from './nodes.js';
import type { AtRuleStatement } from './at-rule.js';
import { isValueSlotArray } from './css-grammar-helpers.js';

/** What an import's `.jess` spelling reads from the printer. */
export interface ImportSpeller {

  /** The converter's path for an import (`EmitJessOptions.importPath`); `undefined` when it gives none. */
  readonly importPath: (path: string, node: StyleImport) => string | null | undefined;

  /** Whether the statement being printed stands in the `Stylesheet` prologue. */
  readonly prologue: () => boolean;
  readonly value: (node: ValueNode) => string;
  readonly binding: (node: VariableDeclaration) => string;
  readonly gap: (nodeType: string, reason: string) => never;
}

/**
 * `StyleImport` `@-import "<path>"`. Less resolves a bare `"foo"` against the
 * importing file first; `.jess` requires file-relative paths to be written
 * explicitly, so a bare relative target gains `./` (the migration guide's
 * documented rewrite). The option clause has no `.jess` spelling at all.
 */
export function styleImportText(node: StyleImport, speller: ImportSpeller): string {
  const { gap } = speller;
  if (node.mode !== 'import' || node.alias !== null || node.config !== null || node.forward) {
    /* In `.less` every compiler at-rule is spelled with or without the dash; `.jess` requires it (ledger A1). */
    const name = node.name.toLowerCase() === '@compose' ? '@-compose' : node.name;
    if (name === '@-compose' || name === '@-export') {
      const config = node.config === null
        ? ''
        : ` ${node.config.kind} {${node.config.bindings.map(b => ` ${speller.binding(b)};`).join('')} }`;
      const as = node.namespace === null ? '' : ` as ${node.namespace}`;
      return `${name} ${importTarget(node, false, speller) ?? gap('StyleImport', 'a module import that stays a CSS `@import`')}${as}${config}`;
    }
    return gap('StyleImport', 'module import semantics (`as`/`with`/forward) outside `@-compose`/`@-export`');
  }
  if (node.options !== null) {
    const words = node.options.value.map(o => (!isValueSlotArray(o) && 'src' in o ? String(o.src).trim() : '?')).join(', ');
    return gap('StyleImport', `import option \`(${words})\`: \`@-import\` takes no option clause (\`@-reference\` parses only as an inert at-rule)`);
  }
  const target = importTarget(node, node.name !== '@-import', speller);
  if (target === null && !speller.prologue()) {
    return gap('StyleImport', 'an import that stays a CSS `@import`, after a rule: `ImportStatement` is only in the `Stylesheet` prologue');
  }
  return target === null ? `@import ${speller.value(node.target)}` : `@-import ${target}`;
}

/** The quoted `.jess` target, or `null` when the import stays a CSS `@import`. */
function importTarget(node: StyleImport, fromLess: boolean, speller: ImportSpeller): string | null {
  /*
   * A compile-time import's `url(…)` wrapper is syntax around the same path,
   * so it prints as the plain quoted path the `.jess` rule takes.
   */
  const target = node.target.type === 'Url' ? node.target.value : node.target;
  if ((target.type !== 'Quoted' && target.type !== 'Any') || (target.type === 'Quoted' && (target.escaped || target.interp !== null))) {
    return speller.gap('StyleImport', 'an interpolated or escaped import target: `.jess` imports take a plain quoted path');
  }
  const quote = target.type === 'Quoted' ? target.quote : '"';
  const path = target.type === 'Quoted' ? target.value : target.src;
  const relative = !fromLess || path.startsWith('./') || path.startsWith('../') || path.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/iu.test(path);
  const converted = speller.importPath(path, node);
  const rewritten = converted === undefined ? (relative ? path : `./${path}`) : converted;
  return rewritten === null
    ? null
    : rewritten.includes(quote)
      ? speller.gap('StyleImport', 'an import path containing its own quote character')
      : `${quote}${rewritten}${quote}`;
}

/** The root CSS `@import`s a body writes first, printed, and every one the render moved ({@link preludeImports}). */
export interface Prelude {
  readonly leads: string;
  readonly moved: ReadonlySet<Statement>;
}

export const NO_PRELUDE: Prelude = { leads: '', moved: new Set() };

/**
 * The root CSS `@import`s the render wrote in the output prelude
 * (`EmitJessOptions.preludeImport`): `'first'` ones printed, to lead the file,
 * and every one it moved, `'dropped'` duplicates included. A gap the converter
 * throws for one goes to `record`, and the import prints nothing.
 */
export function preludeImports(
  rules: readonly Statement[],
  place: ((node: AtRuleStatement) => 'first' | 'dropped' | null) | undefined,
  print: (node: Statement) => string,
  record: (error: unknown) => void
): Prelude {
  if (place === undefined) {
    return NO_PRELUDE;
  }
  let leads = '';
  const moved = new Set<Statement>();
  for (const rule of rules) {
    try {
      const placed = rule.type === 'AtRuleStatement' ? place(rule) : null;
      if (placed !== null) {
        moved.add(rule);
        leads += placed === 'first' ? print(rule) : '';
      }
    } catch (error) {
      record(error);
      moved.add(rule);
    }
  }
  return { leads, moved };
}
