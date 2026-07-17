/**
 * Structured compiler diagnostics for `@jesscss/core`.
 *
 * Core produces STRUCTURED diagnostics (code, phase, location, meta, severity);
 * terminal RENDERING (code frames, clickable links, colors) lives in the CLI
 * layer (`@jesscss/jess`), which drives it off `toDiagnostic()` + `linecraft`.
 *
 * This module is a compatibility barrel re-exporting the `error/` submodules:
 * - `error/codes.ts`      — error-code registry, templates, display overrides
 * - `error/code-frame.ts` — source line/column extraction (structured data)
 * - `error/jess-error.ts` — the `JessError` class
 * - `error/diagnostics.ts`— diagnostic types, parser adapter, ERR/WARN factories
 */
export {
  type JessErrorCode,
  type Phase,
  type Severity,
  isJessErrorCode,
  displayOverrideFor
} from './error/codes.js';

export {
  type EvalErrorFrame,
  lineColAt,
  extractRelevantLines,
  evalErrorFrameFrom
} from './error/code-frame.js';

export {
  type TreeContextLike,
  type LocNode,
  type JessErrorInit,
  JessError
} from './error/jess-error.js';

export {
  type ErrorDiagnostic,
  type WarningDiagnostic,
  makeJessError,
  makeJessErrorFromDiagnostic,
  getErrorFromParser,
  toDiagnostic,
  ERR,
  WARN
} from './error/diagnostics.js';
