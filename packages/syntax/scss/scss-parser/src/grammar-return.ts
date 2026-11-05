import { decl, isDiagnosticStatement, sourceEndOf, sourceStartOf, spaced, valueSlot, withSourceSpan } from '@jesscss/core/ast';
import type { Statement, ValueNode } from '@jesscss/core/ast';
import { requireValue } from './grammar-helpers.js';

/** The at-rule name of a `@return` the reducer builds; {@link lowerFunctionReturns} reads it back. */
export const RETURN_DIRECTIVE = '@return';

/** The prelude of a directive; a space list is the array `Value` builds. */
export function directivePrelude(value: unknown): ValueNode {
  return requireValue(Array.isArray(value) ? spaced(value) : value);
}

/**
 * Lower each `@return` a function can read to its `result: v` declaration: one
 * directly in the body, or in an `@if`/`@else` branch of it. Any other stays the
 * marked statement `ReturnRule` built, which fails the compile where it is reached.
 *
 * Returns whether the body holds a statement that may hide such a `@return`.
 */
export function lowerFunctionReturns(statements: Statement[]): boolean {
  let opaque = false;
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]!;
    if (statement.type === 'AtRuleStatement') {
      if (statement.name === RETURN_DIRECTIVE && isDiagnosticStatement(statement) && statement.prelude !== null) {
        statements[i] = withSourceSpan(decl('result', valueSlot(statement.prelude)), { start: sourceStartOf(statement), end: sourceEndOf(statement) });
      }
    } else if (statement.type === 'If') {
      for (const branch of statement.branches) {
        opaque = lowerFunctionReturns(branch.rules) || opaque;
      }
    } else if (statement.type !== 'Declaration' && statement.type !== 'VariableDeclaration' && statement.type !== 'Comment') {
      opaque = true;
    }
  }
  return opaque;
}
