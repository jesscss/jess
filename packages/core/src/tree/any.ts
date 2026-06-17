/**
 * Import from node-base to avoid circular dependency.
 * The patching happens in node.ts
 */
import { Node, defineType, type LocationInfo, type NodeOptions, F_STATIC } from './node-base.js';
import type { Context } from '../context.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';

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

  readonly role: Role | undefined;

  constructor(
    value: string,
    options?: AnyOptions<Role>,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.role = options?.role as Role | undefined;
    this.addFlag(F_STATIC);
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
    const normalize = (s: string) => s.replace(/;\s*/g, ', ').replace(/\s+/g, ' ').trim();
    return normalize(this.toString()) === normalize(other.toString()) ? 0 : undefined;
  }
}

// Custom any function that properly handles role narrowing
export function any<Role extends AnyRole = AnyRole>(
  value: string,
  options?: AnyOptions<Role>,
  location?: LocationInfo,
  treeContext?: Context['treeContext']
): Any<Role> {
  return new Any(value, options, location, treeContext);
}
defineType(Any, 'Any');

/** Legacy class - remove? */
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
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    // Force role to 'keyword'
    super(value, { ...options, role: 'keyword' }, location, treeContext);
  }
}
defineType(Keyword, 'Keyword');

/**
 * Helper function to create a Keyword node
 */
export function keyword(
  value: string,
  options?: Omit<NodeOptions, 'role'>,
  location?: LocationInfo,
  treeContext?: Context['treeContext']
): Keyword {
  return new Keyword(value, options, location, treeContext);
}
