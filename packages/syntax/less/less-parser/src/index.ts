import { run } from 'parseman';
import { parserDiagnostic, type ISafeParseResult } from '@jesscss/core';
import {
  createTriviaMapFromParseman,
  withSourceSpan,
  withTriviaMap,
  type Stylesheet
} from '@jesscss/core/ast';
import { lessAstGrammar } from './grammar.js';
import { LessParseError } from './parse-error.js';

export {
  LessBareVariableInterpolationError,
  LessDynamicCharsetError,
  LessInlineJavaScriptError,
  LessParseError,
  LessUnparenthesizedMixinGuardError,
  LessUnsupportedMixinNameError,
  LessUnsupportedVariableNameError
} from './parse-error.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'rules' in value
    && Array.isArray(value.rules)
  );
}

/** Parse Less directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const entry = lessAstGrammar.Stylesheet;
  const trivia = lessAstGrammar.whitespace;
  if (entry === undefined || trivia === undefined) {
    throw new TypeError(
      'Less AST grammar is missing its public document entry.'
    );
  }
  const result = run(entry, input, { trivia, state: { source: input } });
  if (!result.ok) {
    throw new LessParseError(result.span.start, result.expected);
  }
  if (result.unconsumedFrom !== null) {
    if (result.unconsumedFrom > result.span.start) {
      throw new LessParseError(result.unconsumedFrom, [], {
        message: 'Unexpected Less input after a complete stylesheet.',
        reason:
          'The parser consumed a complete Less stylesheet before this token, so the remaining text is not part of any rule, declaration, or at-rule.',
        fix: 'Remove the extra input or wrap it in valid Less syntax.'
      });
    }
    throw new LessParseError(result.unconsumedFrom, [], {
      message: 'Unexpected Less syntax.',
      reason:
        'The parser could not match this token as the start of a Less rule, declaration, or at-rule.',
      fix: 'Remove the token or rewrite it as valid Less syntax.'
    });
  }
  if (!isStylesheet(result.value)) {
    throw new LessParseError(result.span.end, [], {
      message: 'Less parser did not produce a stylesheet.',
      reason:
        'The Less parser matched the input but returned a value that is not a stylesheet document.',
      fix: 'Report this as a parser bug with the source that triggered it.'
    });
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.triviaMap)
  );
}

/**
 * Parse Less for the product plugin path. Parser packages own recognition facts;
 * this boundary attaches file/source context once and returns normalized
 * diagnostics for compiler and CLI consumers to render.
 */
export function safeParse(filePath: string, input: string): ISafeParseResult {
  try {
    return { document: parse(input), errors: [], warnings: [] };
  } catch (error) {
    return {
      errors: [
        parserDiagnostic({ dialect: 'Less', error, filePath, source: input })
      ],
      warnings: []
    };
  }
}
