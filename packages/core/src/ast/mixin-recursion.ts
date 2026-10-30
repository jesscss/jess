import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import type { JessError } from '../error/jess-error.js';
import { callSiteLocation } from './call-site-location.js';
import type { MixinCall } from './nodes.js';

/**
 * [recursion-backstop] Maximum depth of NESTED mixin expansions. Parametric
 * self-recursion is terminated by its guard; a bad guard is a runaway. This
 * limit stops a runaway whose levels do not grow the JS stack, because each one
 * awaits before the next. A synchronous runaway usually exhausts the native
 * stack first: one level costs a dozen or more JS frames, and more through an
 * at-rule body, so a cold process overflows at a few hundred levels. That
 * overflow is reported as this same error ({@link runawayMixinError}). It is a
 * runaway BACKSTOP, not a recursion cap.
 */
export const MAX_MIXIN_DEPTH = 500;

/** The error for a mixin call that never stops expanding itself, at that call. */
export function mixinRecursionLimit(call: MixinCall, s: { readonly context: Context | undefined }): JessError {
  return ERR.mixinRecursionLimit({
    node: call,
    ...callSiteLocation(call, s),
    meta: { name: call.name, limit: MAX_MIXIN_DEPTH }
  });
}

/**
 * The error a mixin expansion rethrows: a native stack overflow becomes the
 * recursion error at `call`, and anything else passes through unchanged.
 *
 * The depth limit cannot stand in for this. The native stack is measured in
 * bytes, and what a level costs depends on the path through the walker (about
 * 12 frames for a plain self-call, about 25 through an at-rule body, plus the
 * candidate lookup's walk over the open callers), on how much of the code is
 * optimized yet, and on the host's stack size and starting depth. A limit low
 * enough to fire first everywhere would also reject guarded recursion that
 * renders today. The innermost expansion with room to build the error reports
 * it; one without room overflows again, and the next one out does.
 */
export function runawayMixinError(error: unknown, call: MixinCall, s: { readonly context: Context | undefined }): unknown {
  return isStackOverflow(error) ? mixinRecursionLimit(call, s) : error;
}

/** V8 and JavaScriptCore raise a `RangeError`, SpiderMonkey an `InternalError`. */
function isStackOverflow(error: unknown): boolean {
  return error instanceof RangeError
    ? error.message.startsWith('Maximum call stack size exceeded')
    : error instanceof Error && error.name === 'InternalError' && error.message === 'too much recursion';
}
