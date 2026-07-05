/**
 * Bitmask-based node type system.
 *
 * Each concrete node type gets a single bit. Abstract parent types
 * (Selector, SimpleSelector) are masks combining their children's bits.
 * A node's `nodeType` field is the OR of its own bit and all ancestor bits.
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
  /** AtRuleStatement shares the AtRule bit (32-bit mask exhausted). Use instanceof AtRuleStatement for exact identity. */
  AtRuleStatement   = AtRule,

  // Other types
  Reference         = 1 << 27,
  Comment           = 1 << 28,
  JsFunction        = 1 << 29,
  JsObject          = 1 << 30,
  // Note: 1 << 31 is negative in JS (sign bit), so we use it carefully
  JsArray           = 1 << 31,

  // ── Abstract / parent masks ──────────────────────────────────────
  // These combine child bits so isNode(x, N.Selector) matches any selector.

  SimpleSelector    = BasicSelector | Ampersand | PseudoSelector,
  Selector          = SimpleSelector | CompoundSelector | ComplexSelector | SelectorList | Combinator
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
 * RelativeSelector intentionally shares the ComplexSelector bit because the
 * 32-bit mask is exhausted and relative selectors use the same core operations.
 * Use `node.type` or `instanceof RelativeSelector` when exact identity matters.
 */
export const nodeTypeBits: Record<string, number> = {
  // Concrete leaf types — each gets its own bit
  BasicSelector: N.BasicSelector,
  Ampersand: N.Ampersand,
  PseudoSelector: N.PseudoSelector,
  CompoundSelector: N.CompoundSelector,
  ComplexSelector: N.ComplexSelector,
  RelativeSelector: N.ComplexSelector,
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
  Mixin: N.Mixin,
  Declaration: N.Declaration,
  VarDeclaration: N.VarDeclaration,
  Rules: N.Rules,
  Stylesheet: N.Rules,
  Collection: N.Collection,
  Ruleset: N.Ruleset,
  AtRule: N.AtRule,
  AtRuleStatement: N.AtRule,
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
