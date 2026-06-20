/**
 * Bitmask-based node type system.
 *
 * Each concrete node type gets a single bit. Abstract parent types
 * (Selector, SimpleSelector, RuleContainer) are masks combining their
 * children's bits.
 *
 * isNode(x, N.Foo) compiles to: x.nodeType & Foo (one bitwise AND)
 */

// ── Leaf bits (one bit per concrete type) ──────────────────────────
// These are types that are checked via isNode AND are concrete (not abstract).
// Sorted roughly by hierarchy grouping.

export enum N {
  // Selector subtypes
  BasicSelector     = 1 << 0,
  Ampersand         = 1 << 1,
  PseudoSelector    = 1 << 2,
  CompoundSelector  = 1 << 3,
  ComplexSelector   = 1 << 4,
  SelectorList      = 1 << 5,
  Combinator        = 1 << 6,

  // Value types
  Any               = 1 << 7,
  Color             = 1 << 8,
  Dimension         = 1 << 9,
  Quoted            = 1 << 10,
  Expression        = 1 << 11,
  Operation         = 1 << 12,
  Paren             = 1 << 13,
  Range             = 1 << 14,
  List              = 1 << 15,
  Sequence          = 1 << 16,
  Nil               = 1 << 17,

  // Callable types
  Call              = 1 << 18,
  Func              = 1 << 19,
  Mixin             = 1 << 20,

  // Declaration types
  Declaration       = 1 << 21,
  VarDeclaration    = 1 << 22,

  // Container types
  Rules             = 1 << 23,
  Collection        = 1 << 24,
  Ruleset           = 1 << 25,
  AtRule            = 1 << 26,

  // Other types
  Reference         = 1 << 27,
  Comment           = 1 << 28,
  JsFunction        = 1 << 29,
  JsObject          = 1 << 30,
  // Note: 1 << 31 is negative in JS (sign bit), so we use it carefully.
  // JsArray is checked by class identity rather than isNode(..., N.JsArray).
  AtRuleStatement   = 1 << 31,
  JsArray           = 0,

  // ── Abstract / parent masks ──────────────────────────────────────
  // These combine child bits so isNode(x, N.Selector) matches any selector.

  SimpleSelector    = BasicSelector | Ampersand | PseudoSelector,
  Selector          = SimpleSelector | CompoundSelector | ComplexSelector | SelectorList | Combinator,
  RuleContainer     = Rules | Ruleset | AtRule | Mixin
}

/**
 * Map from type name string → bitmask.
 * Used by defineType to look up the mask for a given type name
 * when walking the prototype chain.
 */
/**
 * Map from type name string → bitmask.
 * Used by defineType to look up the bit for a given type name
 * when walking the prototype chain.
 *
 * IMPORTANT: Abstract parent types (Selector, SimpleSelector) map to 0 here.
 * Their combined masks (N.Selector, N.SimpleSelector) are only used by
 * isNode callers, NOT by defineType. Each concrete child already has its own
 * bit, so when defineType walks the chain, the child's bit is sufficient.
 */
export const nodeTypeBits: Record<string, number> = {
  // Concrete leaf types — each gets its own bit
  BasicSelector: N.BasicSelector,
  Ampersand: N.Ampersand,
  PseudoSelector: N.PseudoSelector,
  CompoundSelector: N.CompoundSelector,
  ComplexSelector: N.ComplexSelector,
  SelectorList: N.SelectorList,
  Combinator: N.Combinator,
  Any: N.Any,
  Color: N.Color,
  Dimension: N.Dimension,
  Quoted: N.Quoted,
  Expression: N.Expression,
  Operation: N.Operation,
  Paren: N.Paren,
  Range: N.Range,
  List: N.List,
  Sequence: N.Sequence,
  Nil: N.Nil,
  Call: N.Call,
  Func: N.Func,
  Mixin: N.Mixin | N.Rules,
  Declaration: N.Declaration,
  VarDeclaration: N.VarDeclaration,
  Rules: N.Rules,
  Collection: N.Collection,
  Ruleset: N.Ruleset | N.Rules,
  AtRule: N.AtRule | N.Rules,
  AtRuleStatement: N.AtRuleStatement,
  If: N.Rules,
  For: N.Rules,
  While: N.Rules,
  Reference: N.Reference,
  Comment: N.Comment,
  JsFunction: N.JsFunction,
  JsObject: N.JsObject,
  JsArray: N.JsArray,

  // Abstract parent types — 0 because children already have their own bits.
  // The combined masks (N.Selector, N.SimpleSelector) are for isNode callers only.
  Selector: 0,
  SimpleSelector: 0
};
