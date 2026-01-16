/**
 * Type mapping utilities for converting between Jess and Less node types
 */

/**
 * Map Jess node types to Less node types
 *
 * @param jessType - The Jess node type
 * @returns The corresponding Less node type
 */
export function mapJessTypeToLessType(jessType: string): string {
  const typeMap: Record<string, string> = {
    Ruleset: 'Ruleset',
    Declaration: 'Declaration',
    SelectorList: 'Selector',
    ComplexSelector: 'Selector',
    CompoundSelector: 'Selector',
    BasicSelector: 'Element', // Note: Less's Element includes combinator
    Combinator: 'Combinator',
    AttributeSelector: 'Attribute',
    Dimension: 'Dimension',
    Num: 'Dimension',
    Reference: 'Variable', // Default, but can be Variable/Property/VariableCall
    Mixin: 'MixinDefinition',
    Call: 'Call',
    Operation: 'Operation',
    Expression: 'Expression',
    Quoted: 'Quoted',
    Url: 'URL',
    Color: 'Color',
    Comment: 'Comment',
    AtRule: 'AtRule',
    StyleImport: 'Import',
    Extend: 'Extend',
    Condition: 'Condition',
    Paren: 'Paren',
    Negative: 'Negative',
    List: 'Value',
    VarDeclaration: 'Assignment',
    Keyword: 'Keyword'
  };

  return typeMap[jessType] || jessType;
}

/**
 * Map Less node types to Jess node types
 *
 * @param lessType - The Less node type
 * @returns The corresponding Jess node type
 */
export function mapLessTypeToJessType(lessType: string): string {
  const typeMap: Record<string, string> = {
    Ruleset: 'Ruleset',
    Declaration: 'Declaration',
    Selector: 'SelectorList', // Less Selector → Jess SelectorList
    Element: 'BasicSelector', // Note: Less Element includes combinator
    Combinator: 'Combinator',
    Attribute: 'AttributeSelector',
    Dimension: 'Dimension',
    Variable: 'Reference',
    Property: 'Reference',
    VariableCall: 'Reference',
    MixinDefinition: 'Mixin',
    MixinCall: 'Call',
    Call: 'Call',
    Operation: 'Operation',
    Expression: 'Expression',
    Quoted: 'Quoted',
    URL: 'Url',
    Color: 'Color',
    Comment: 'Comment',
    AtRule: 'AtRule',
    // Less.js v2 used "Directive" - map to AtRule for compatibility
    Directive: 'AtRule',
    // Less.js v2 used "Rule" - map to Declaration for compatibility
    Rule: 'Declaration',
    Import: 'StyleImport',
    Extend: 'Extend',
    Condition: 'Condition',
    Paren: 'Paren',
    Negative: 'Negative',
    Value: 'List',
    Assignment: 'VarDeclaration',
    Keyword: 'Keyword'
  };

  return typeMap[lessType] || lessType;
}

/**
 * Get Less typeIndex for a Jess node type
 *
 * Less.js uses typeIndex for visitor caching. This function
 * maps Jess types to their corresponding Less typeIndex values.
 *
 * @param jessType - The Jess node type
 * @returns The Less typeIndex, or undefined if not found
 */
export function getLessTypeIndex(_jessType: string): number | undefined {
  // Less.js assigns typeIndex dynamically, so we'll need to
  // either:
  // 1. Import Less's tree module and access typeIndex
  // 2. Maintain our own mapping
  // 3. Set typeIndex dynamically when creating proxies

  // For now, return undefined - will be set during proxy creation
  return undefined;
}
