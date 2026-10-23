import { delimiterClose, delimiterOpen, isValueSlotArray, sepGlue, sourceStartOf } from '@jesscss/core/ast';
import type { Expression, MixinCall, ValueSlot } from '@jesscss/core/ast';

type MixinCallArgument = MixinCall['args'][number];
type CallValue = ValueSlot | MixinCall;

/*
 * Source fallback for a grammar fact: the `raw` text a mixin reference keeps
 * beside its typed arguments, for a chain that cannot resolve. This walks
 * already reduced facts; it never inspects or re-parses source bytes.
 */

/** One authored call argument re-spelled, KEYWORD INCLUDED. A named argument
 *  whose name were dropped here would re-emit as a positional one — the same
 *  lossy re-derivation the node shape exists to prevent. */
export function callArgumentSource(argument: MixinCallArgument): string {
  return `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`;
}

/**
 * An `Expression` owns no delimiters of its own: a math computation (ledger
 * P35) is replayed with parens only when the author wrote them. A paren group
 * that became the boundary starts before its value does; bare math starts
 * where its value starts.
 */
export function expressionWroteParens(node: Expression): boolean {
  return !isValueSlotArray(node.value) && sourceStartOf(node) !== sourceStartOf(node.value);
}

function mixinArgumentSource(value: CallValue): string {
  if (isValueSlotArray(value)) {
    return value.map(part => mixinArgumentSource(part)).join(' ');
  }
  switch (value.type) {
    case 'MixinCall': {
      const path = value.path.map((segment, index) => index === 0 ? segment.selector : `${segment.combinator}${segment.selector}`).join('');
      return `${path}${value.name}(${value.args.map(callArgumentSource).join(', ')})${value.important ? ' !important' : ''}`;
    }
    case 'Keyword': case 'Color': case 'Dimension': case 'Any': case 'SelectorCapture': case 'Quoted': case 'Condition': return value.src;
    case 'Lookup': return value.kind === 'var'
      ? `@${typeof value.name === 'string' ? value.name : mixinArgumentSource(value.name)}`
      : value.raw;
    case 'Reference': return value.raw;
    case 'FunctionCall': return `${value.name}(${value.args.map(callArgumentSource).join(', ')})`;
    /* A curly list written without its braces is Less's `~( … )` (ledger P51). */
    case 'Block': return value.escaped === true
      ? `~(${mixinArgumentSource(value.value)})`
      : `${delimiterOpen(value.delimiter)}${mixinArgumentSource(value.value)}${delimiterClose(value.delimiter)}`;
    case 'Branch': return `${mixinArgumentSource(value.condition)}:${isValueSlotArray(value.value) && value.value.length === 0 ? '' : ` ${mixinArgumentSource(value.value)}`}`;
    case 'Operation': return `${mixinArgumentSource(value.left)} ${value.operator} ${mixinArgumentSource(value.right)}`;
    case 'Sequence': return value.parts.map(mixinArgumentSource).join(' ');
    case 'List': return value.value.map(mixinArgumentSource).join(sepGlue(value.sep));
    case 'Important': return `${mixinArgumentSource(value.value)} !important`;
    case 'Url': return `url(${mixinArgumentSource(value.value)})`;
    /* A lowered `if()` / `boolean()` keeps the call it came from (ledger P36); `not`/`and`/`or` keep it as the condition's spelling. */
    case 'IfValue':
      if (value._asCall !== null) {
        return mixinArgumentSource(value._asCall);
      }
      break;
    case 'Expression':
      return value._asCall !== null
        ? mixinArgumentSource(value._asCall)
        : expressionWroteParens(value) ? `(${mixinArgumentSource(value.value)})` : mixinArgumentSource(value.value);
    default:
      break;
  }
  throw new TypeError(`Less mixin-reference raw source cannot represent ${value.type}.`);
}
