/**
 * Eval-error source location stamping.
 *
 * The eval seam stamps a source span onto ordinary runtime errors on the cold
 * throw path. Code-frame rendering reads it back later without depending on the
 * legacy tree provenance module.
 */

interface EvalErrorLocationCarrier {
  _jessEvalSpanStart?: number;
  _jessEvalSpanEnd?: number;
  _jessEvalSource?: string;
}

/** The resolved eval location previously stamped onto an error, if any. */
export interface EvalErrorLocation {
  spanStart: number;
  spanEnd?: number;
  source?: string;
}

/**
 * Stamp a source span onto a thrown error so a downstream catch can point the
 * code frame at the authored location. The first stamped location wins.
 */
export function stampEvalErrorLocation(
  err: unknown,
  spanStart: number | undefined,
  spanEnd: number | undefined,
  source: string | undefined
): void {
  if (err === null || typeof err !== 'object' || spanStart === undefined) {
    return;
  }
  const carrier: EvalErrorLocationCarrier = err;
  if (carrier._jessEvalSpanStart !== undefined) {
    return;
  }
  carrier._jessEvalSpanStart = spanStart;
  carrier._jessEvalSpanEnd = spanEnd;
  carrier._jessEvalSource = source;
}

/** Read back the eval location an earlier stamp attached, if present. */
export function readEvalErrorLocation(err: unknown): EvalErrorLocation | undefined {
  if (err === null || typeof err !== 'object') {
    return undefined;
  }
  const carrier: EvalErrorLocationCarrier = err;
  const spanStart = carrier._jessEvalSpanStart;
  if (spanStart === undefined) {
    return undefined;
  }
  return { spanStart, spanEnd: carrier._jessEvalSpanEnd, source: carrier._jessEvalSource };
}
