import { ERR, PROGID_IE_SYNTAX, nameValueIeSyntax, type LegacyIeSyntax } from '@jesscss/core';
import type { CssCstNode } from '@jesscss/css-parser/cst-host';
import {
  CUSTOM_DECLARATION_TYPES,
  CUSTOM_PROPERTY_VALUE_TYPES,
  DECLARATION_TYPES,
  FUNCTION_TYPES,
  RULESET_TYPES,
  absoluteEnd,
  absoluteStart,
  cstChildrenOf,
  isCstNode
} from './cst-node.js';
import type { JessLanguage } from './types.js';

/** Reports one parse-phase diagnostic at a CST span. */
type ParseTwinPusher = (
  code: string,
  severity: 'error',
  message: string,
  span: CssCstNode['span'],
  details: { readonly phase: 'parse'; readonly reason: string; readonly fix: string }
) => void;

/*
 * Legacy IE syntax, read from the CST: the editor twin of the compiler's
 * declaration check (`legacyIeSyntaxIn`, `@jesscss/core`). A declaration value
 * is read as a flat run of atoms — an identifier, a delim, a call, a paren
 * group, a comma, or any other value — through the containers each dialect
 * nests them in, so the two forms read the same in all four CSTs: `progid`
 * then a `:` delim, and a call argument that is exactly an identifier, an `=`
 * delim and one value. A Less `=` in a call argument is its comparison
 * operator, a token rather than a delim, so Less never has the second form.
 */
type IeAtom =
  | { readonly kind: 'ident' | 'delim'; readonly text: string }
  | { readonly kind: 'call' | 'group'; readonly node: CssCstNode }
  | { readonly kind: 'comma' | 'other' };

const IE_COMMA: IeAtom = { kind: 'comma' };
const IE_OTHER: IeAtom = { kind: 'other' };
const IE_IDENT_TYPES = new Set(['Keyword', 'KeywordOrInterpolatedValue', 'Identifier']);
const IE_DELIM_TYPES = new Set(['DeclarationAny']);
const IE_OPAQUE_TYPES = new Set([
  ...DECLARATION_TYPES,
  ...CUSTOM_DECLARATION_TYPES,
  ...CUSTOM_PROPERTY_VALUE_TYPES,
  ...RULESET_TYPES,
  'CustomValue',
  'Quoted',
  'Interpolation',
  'InterpolatedValue'
]);

function ieAtoms(node: CssCstNode, source: string, out: IeAtom[]): IeAtom[] {
  for (const child of cstChildrenOf(node)) {
    if (child._tag === 'leaf') {
      if (source.slice(Number(child.span.start), Number(child.span.end)).trim() === ',') {
        out.push(IE_COMMA);
      }
      continue;
    }
    if (!isCstNode(child)) {
      continue;
    }
    const gt = child.grammarType;
    const children = cstChildrenOf(child);
    if (FUNCTION_TYPES.has(gt)) {
      out.push({ kind: 'call', node: child });
    } else if (IE_OPAQUE_TYPES.has(gt)) {
      out.push(IE_OTHER);
    } else if (children.some(grandchild => grandchild._tag === 'leaf' && grandchild.value === '(')) {
      out.push({ kind: 'group', node: child });
    } else if (children.some(isCstNode)) {
      ieAtoms(child, source, out);
    } else if (IE_IDENT_TYPES.has(gt) || IE_DELIM_TYPES.has(gt)) {
      out.push({ kind: IE_IDENT_TYPES.has(gt) ? 'ident' : 'delim', text: source.slice(absoluteStart(child), absoluteEnd(child)) });
    } else {
      out.push(IE_OTHER);
    }
  }
  return out;
}

function isIeAtom(atom: IeAtom | undefined, kind: 'ident' | 'delim', text?: string): atom is { kind: 'ident' | 'delim'; text: string } {
  return atom?.kind === kind && (text === undefined || ('text' in atom && atom.text === text));
}

function legacyIeSyntaxInAtoms(atoms: readonly IeAtom[], source: string): LegacyIeSyntax | undefined {
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    if (isIeAtom(atom, 'ident') && atom.text.toLowerCase() === 'progid' && isIeAtom(atoms[i + 1], 'delim', ':')) {
      return PROGID_IE_SYNTAX;
    }
    if (atom.kind === 'group') {
      const found = legacyIeSyntaxInAtoms(ieAtoms(atom.node, source, []), source);
      if (found !== undefined) {
        return found;
      }
    }
    if (atom.kind === 'call') {
      const inner = ieAtoms(atom.node, source, []);
      let from = 0;
      for (let at = 0; at <= inner.length; at++) {
        if (at < inner.length && inner[at]!.kind !== 'comma') {
          continue;
        }
        const arg = inner.slice(from, at);
        const name = arg[0];
        const found = (arg.length === 3 && isIeAtom(name, 'ident') && isIeAtom(arg[1], 'delim', '=') ? nameValueIeSyntax(name.text) : undefined)
          ?? legacyIeSyntaxInAtoms(arg, source);
        if (found !== undefined) {
          return found;
        }
        from = at + 1;
      }
    }
  }
  return undefined;
}

/**
 * The editor twins of errors the compiler raises on a parsed shape: reported
 * from the tolerant CST node, so the rest of the document keeps its
 * diagnostics.
 */
export function pushParseTwinDiagnostics(
  node: CssCstNode,
  gt: string,
  language: JessLanguage,
  source: string,
  push: ParseTwinPusher
): void {
  /*
   * Less v5 removes executable backtick values, but the tolerant CST keeps the
   * complete legacy construct as one node. Report from that node so editors
   * underline exactly the removed expression and retain the rest of the tree.
   * The compiler's strict AST entry throws the matching parser error before
   * evaluation; this path is the non-halting editor/diagnostic twin.
   */
  if (language === 'less' && gt === 'BacktickJavaScript') {
    push(
      'parse/unsupported-inline-javascript',
      'error',
      'Inline JavaScript was removed in Less v5. Move it to a module loaded with @use.',
      node.span,
      {
        phase: 'parse',
        reason: 'Backtick JavaScript expressions cannot be enabled or evaluated.',
        fix: 'Move it to a module loaded with @use.'
      }
    );
  }

  /* Legacy IE syntax: the compiler fails at the declaration, so the editor underlines the declaration. */
  if (DECLARATION_TYPES.has(gt)) {
    const found = legacyIeSyntaxInAtoms(ieAtoms(node, source, []), source);
    if (found !== undefined) {
      const error = ERR.legacyIeSyntax({ meta: { what: found.what, fix: found.fix } });
      push('css/legacy-ie-syntax', 'error', error.message, node.span, {
        phase: 'parse',
        reason: error.reason,
        fix: error.fix
      });
    }
  }

  /*
   * Shapes the strict Less AST rejects by name — a slash-led value (ledger
   * P33) and an uncalled mixin reference (rejected today; ruling OPEN under
   * P33) — are kept as nodes in the tolerant CST, so their twin is reported
   * from the node.
   */
  if (language === 'less' && gt === 'LeadingSeparatorValue') {
    push(
      'parse/leading-separator-value',
      'error',
      'A Less value cannot start with "/".',
      node.span,
      {
        phase: 'parse',
        reason: 'A slash separates two values, so it needs a value before it. A path is a value only inside url() or a string.',
        fix: 'Write the path as url(/path) or as an escaped string such as ~"/path".'
      }
    );
  }
  if (language === 'less' && gt === 'UncalledMixinReference') {
    const name = source.slice(absoluteStart(node), absoluteEnd(node));
    push(
      'parse/uncalled-mixin-reference',
      'error',
      'A mixin reference is not a value.',
      node.span,
      {
        phase: 'parse',
        reason: 'In a value, a mixin reference must be called or looked up; on its own it has no value.',
        fix: `Call it as ${name}() to use its result, or write ~"${name}" to keep it as text.`
      }
    );
  }
}
