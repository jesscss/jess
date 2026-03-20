/**
 * Extend debugging: gate and runId for syncLog tracing.
 * Enable when DEBUG_EXTEND_TRACE=1, when compiling a file whose path includes 'extend-chaining',
 * or when runId is 'constructed' (core test builds AST in code, no file path).
 */
import type { Context } from '../../context.js';

export function shouldTraceExtend(ctx: Context | undefined): boolean {
  if (!ctx) {
    return false;
  }
  if (process.env.DEBUG_EXTEND_TRACE === '1') {
    return true;
  }
  const runId = getExtendTraceRunId(ctx);
  if (runId === 'constructed') {
    return true;
  }
  if (runId.includes('extend-chaining')) {
    return true;
  }
  return false;
}

/** Trace when we're in the .md extend path (and collapseNesting when we want to limit to that path). */
export function shouldTraceExtendMd(ctx: Context | undefined, targetValueOf: string): boolean {
  if (targetValueOf !== '.md') {
    return false;
  }
  return true;
}

export function getExtendTraceRunId(ctx: Context | undefined): string {
  if (!ctx) {
    return 'unknown';
  }
  const file = ctx.treeContext?.file;
  const pathStr = typeof (file as { fullPath?: string })?.fullPath === 'string'
    ? (file as { fullPath: string }).fullPath
    : typeof (file as { path?: string })?.path === 'string'
      ? (file as { path: string }).path
      : '';
  return pathStr || 'constructed';
}

/** Whether we're in the parsed (jess/file) run vs constructed (core test) run. */
export function isConstructedRun(ctx: Context | undefined): boolean {
  return getExtendTraceRunId(ctx) === 'constructed';
}
