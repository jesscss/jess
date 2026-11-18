/** The reducer of `.jess`'s `@-expose` (ledger A20), imported so the grammar's reducer carries it. */
import type { FieldMap, Span } from 'parseman';
import { ExposeDeclarationError, MalformedExposeError, type ExposeSpelling } from '@jesscss/core/diagnostics';
import { exposedName, variableExpose, withSourceSpan, type VariableDeclaration, type VariableExpose } from '@jesscss/core/ast';
import { isVarDeclaration, reportRecovered, requireFields, requireString } from './grammar-helpers.js';

const JESS_EXPOSE: ExposeSpelling = { keyword: '@-expose', sigil: '$' };

/** Its located names; a declaration (kept) or text after them is reported at the statement (P45). */
export function exposeFrom(fields: FieldMap | undefined, span: Span, state: unknown): VariableExpose | VariableDeclaration {
  const declaration: unknown = fields?.declaration && requireFields(fields, 'declaration')[0]?.value;
  if (isVarDeclaration(declaration)) {
    reportRecovered(new ExposeDeclarationError(span.start, span.end, declaration.name, JESS_EXPOSE, declaration), state);
    return declaration;
  }
  const names = fields?.name ? requireFields(fields, 'name').map(name => withSourceSpan(exposedName(requireString(name.value)), name.span)) : [];
  const exposed = withSourceSpan(variableExpose(names, JESS_EXPOSE), span);
  const rest = fields?.rest && requireFields(fields, 'rest')[0]?.span;
  if (!names.length || (rest && rest.end > rest.start) || fields?.block) {
    reportRecovered(new MalformedExposeError(span.start, span.end, JESS_EXPOSE, exposed), state);
  }
  return exposed;
}
