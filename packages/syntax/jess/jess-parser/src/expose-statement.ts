/**
 * The reduction of `.jess`'s `@-expose` statement (ledger A20). Like
 * `grammar-helpers.ts`, an importable module, so the grammar's reducer carries
 * it by import.
 */
import type { FieldMap, Span } from 'parseman';
import { ExposeDeclarationError, MalformedExposeError, type ExposeSpelling } from '@jesscss/core/diagnostics';
import { exposedName, variableExpose, withSourceSpan, type VariableDeclaration, type VariableExpose } from '@jesscss/core/ast';
import { isVarDeclaration, reportRecovered, requireFields, requireString } from './grammar-helpers.js';

/** `.jess` writes the expose statement `@-expose` and a variable's read `$` (ledger A1, A20). */
const JESS_EXPOSE: ExposeSpelling = { keyword: '@-expose', sigil: '$' };

/**
 * `@-expose brand, gap;`: the names it publishes, each located. The declaration
 * form (`@-expose $brand: red;`) keeps its declaration, so the rest of the
 * document evaluates; it and any other shape are reported at the statement
 * (P45).
 */
export function exposeFrom(fields: FieldMap | undefined, span: Span, state: unknown): VariableExpose | VariableDeclaration {
  const declaration: unknown = fields?.declaration === undefined ? undefined : requireFields(fields, 'declaration')[0]?.value;
  if (isVarDeclaration(declaration)) {
    reportRecovered(new ExposeDeclarationError(span.start, span.end, declaration.name, JESS_EXPOSE, declaration), state);
    return declaration;
  }
  const names = fields?.name === undefined
    ? []
    : requireFields(fields, 'name').map(name => withSourceSpan(exposedName(requireString(name.value)), name.span));
  const exposed = withSourceSpan(variableExpose(names, JESS_EXPOSE), span);

  /* The rest scan is empty unless text follows the names before the `;`, block or `}`. */
  const rest = fields?.rest === undefined ? undefined : requireFields(fields, 'rest')[0]?.span;
  if (names.length === 0 || (rest !== undefined && rest.end > rest.start) || fields?.block !== undefined) {
    reportRecovered(new MalformedExposeError(span.start, span.end, JESS_EXPOSE, exposed), state);
  }
  return exposed;
}
