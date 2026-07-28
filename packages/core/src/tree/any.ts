/**
 * Import from node-base to avoid circular dependency.
 * The patching happens in node.ts
 */
import { Node, defineType, type LocationInfo, type NodeOptions, F_STATIC, F_ALLOW_ROOT } from './node-base.js';
import type { Context } from '../context.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';
import { normalizeComparableText } from './util/compare.js';

export type AnyRole =
  'ident'
  | 'name'
  | 'charset'
  | 'keyword'
  | 'property'
  | 'atkeyword'
  | 'urlvalue'
  | 'flag'
  | 'customprop'
  | 'semi'
  | 'operator'
  | 'any';

/** Doesn't get assigned but can be used for inference? */
export type AnyOptions<T extends string> = NodeOptions & {
  role?: T;
};

// AUDIT: Do we still need this? Now that we're storing strings?
export interface Any<
  Role extends AnyRole = AnyRole
> extends Node<string, AnyOptions<Role>> {
  eval(context: Context): Any<Role>;
  valueOf(): string;
}

/**
 * Any is a simple token that has a string value and a role.
 * Sometimes that role is unspecified. Think of it as a generic,
 * and a placeholder for tokens that don't have anything special
 * to do during evaluation.
 *
 * Called "Anonymous" in Less's original tree, but "anonymous"
 * was somewhat a counter-intuitive name.
 */
export class Any<
  Role extends AnyRole = AnyRole
> extends Node<string, AnyOptions<Role>> {
  static override childKeys = null;

  readonly value: string;

  readonly role: Role | undefined;

  constructor(
    value: string,
    options?: AnyOptions<Role>,
    location?: LocationInfo
  ) {
    super(value, options, location);

    // Each node owns its field values (invariant 7): the base stores nothing.
    this.value = value;
    this.role = options?.role as Role | undefined;
    this.addFlag(F_STATIC);

    /*
     * Less's `Anonymous` (this node's namesake) is statement-legal by type
     * (`allowRoot = true`). A root-position call/mixin/detached-ruleset that
     * evaluates to a bare value produces an `Any`, and Less emits it as the
     * final statement — e.g. root-level `e('/* … *\/')`. Keyword (a subclass)
     * is NOT root-legal in Less, so it strips this flag in its constructor.
     */
    this.addFlag(F_ALLOW_ROOT);
  }

  protected override ownStaticFlag(): number {
    return F_STATIC;
  }

  override prepareRegistration(_context: Context): this {
    this.registrationPrepared = true;
    return this;
  }

  // Any values are static and don't need evaluation
  override evalNode(_context: Context): MaybePromise<Node> {
    return this;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override toTrimmedString(options?: PrintOptions): string {
    const out = this.value;
    options?.writer?.add(out, this);
    return out;
  }

  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value, this);
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    // In Less guards, quoted strings are distinct from bare identifiers.
    if (other.type === 'Quoted') {
      return undefined;
    }
    if (other.type === 'Any' || other.type === 'Keyword') {
      return this.value === String(other.valueOf?.() ?? '') ? 0 : undefined;
    }
    if (other.type === 'Num' || other.type === 'Dimension') {
      const text = this.value.trim();
      if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
        return undefined;
      }
      const otherNumber = 'number' in other ? other.number : undefined;
      const otherUnit = 'unit' in other ? other.unit : undefined;
      if (typeof otherNumber !== 'number') {
        return undefined;
      }
      if (other.type === 'Dimension' && otherUnit) {
        return undefined;
      }
      return Number(text) === otherNumber ? 0 : undefined;
    }
    return normalizeComparableText(this.value) === normalizeComparableText(other.toString()) ? 0 : undefined;
  }
}

// Custom any function that properly handles role narrowing
export function any<Role extends AnyRole = AnyRole>(
  value: string,
  options?: AnyOptions<Role>,
  location?: LocationInfo
): Any<Role> {
  return new Any(value, options, location);
}
defineType(Any, 'Any');

/** Legacy Less compatibility alias for `Any`. */
export class Anonymous<
  Role extends AnyRole = AnyRole
> extends Any<Role> {}
defineType(Anonymous, 'Anonymous');

/**
 * Keyword represents a CSS keyword value (e.g., 'auto', 'none', 'inherit', 'and', 'or').
 *
 * This is a convenience class that extends Any with role: 'keyword' fixed.
 * It provides better type safety and aligns with Less.js's Keyword node type
 * for compatibility purposes.
 *
 * Note: In Jess, boolean values ('true', 'false') are represented as Bool nodes,
 * not Keyword nodes, unlike Less.js where they are Keyword instances.
 */
export class Keyword extends Any<'keyword'> {
  constructor(
    value: string,
    options?: Omit<NodeOptions, 'role'>,
    location?: LocationInfo
  ) {
    // Force role to 'keyword'
    super(value, { ...options, role: 'keyword' }, location);

    /*
     * Less's `Keyword` is NOT statement-legal (no `allowRoot`), unlike the
     * `Anonymous`/`Any` base. A bare keyword in statement position stays an
     * eval/invalid-statement error, matching Less.
     */
    this.removeFlag(F_ALLOW_ROOT);
  }
}
defineType(Keyword, 'Keyword');

/**
 * Helper function to create a Keyword node
 */
export function keyword(
  value: string,
  options?: Omit<NodeOptions, 'role'>,
  location?: LocationInfo
): Keyword {
  return new Keyword(value, options, location);
}
