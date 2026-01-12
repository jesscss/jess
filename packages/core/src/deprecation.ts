/**
 * A deprecated feature in the language.
 * 
 * Each deprecation has:
 * - `id`: Unique kebab-case identifier
 * - `description`: Human-readable description (optional)
 */
export class Deprecation {
  /** Unique ID for this deprecation in kebab case */
  readonly id: string;
  
  /** Human-readable description */
  readonly description: string | null;

  /**
   * Constructs a deprecation.
   */
  constructor(
    id: string,
    options: {
      description?: string | null;
    } = {}
  ) {
    this.id = id;
    this.description = options.description ?? null;
  }

  toString(): string {
    return this.id;
  }

  /**
   * Returns the deprecation with a given ID, or null if none exists.
   */
  static fromId(id: string): Deprecation | null {
    return Deprecation.values.find(d => d.id === id) ?? null;
  }

  /**
   * All known deprecations.
   * Add new deprecations here as they are introduced.
   */
  static readonly values: Deprecation[] = [
    new Deprecation('mixin-call-no-parens', {
      description: 'Calling a mixin without parentheses is deprecated.'
    }),
    new Deprecation('mixin-call-whitespace', {
      description: 'Whitespace between a mixin name and parentheses for a mixin call is deprecated.'
    }),
    new Deprecation('dot-slash-operator', {
      description: 'The ./ operator is deprecated.'
    }),
    new Deprecation('variable-in-unknown-value', {
      description: '@[ident] in custom property values is treated as literal text, not a variable reference. Use @{[ident]} if you want it to be evaluated.'
    }),
    new Deprecation('property-in-unknown-value', {
      description: '$[ident] in custom property values is treated as literal text, not a property reference. Use ${[ident]} if you want it to be evaluated.'
    }),
  ];

  /**
   * Used for deprecations coming from user-authored code.
   */
  static readonly userAuthored = new Deprecation('user-authored', {
    description: null
  });
}
