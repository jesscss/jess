/**
 * TypeScript type definitions for Less.js compatibility
 */

// Re-export Less.js types when available
// For now, we'll use any to avoid dependency issues during development

export type LessNode = any;

/**
 * @deprecated Less.js Visitor API - This is a compatibility type for Less.js visitors.
 * Use Jess's native Visitor interface instead when possible.
 */
export type LessVisitor = any;
export type LessRuleset = any;
export type LessSelector = any;
export type LessElement = any;
export type LessDeclaration = any;
export type LessVariable = any;
export type LessProperty = any;
export type LessVariableCall = any;
export type LessMixinDefinition = any;
export type LessMixinCall = any;
export type LessDimension = any;
export type LessColor = any;
export type LessOperation = any;
export type LessExpression = any;
export type LessQuoted = any;
export type LessURL = any;
export type LessComment = any;
export type LessAtRule = any;
export type LessImport = any;
export type LessExtend = any;
export type LessCondition = any;
export type LessParen = any;
export type LessNegative = any;
export type LessValue = any;
export type LessAssignment = any;
