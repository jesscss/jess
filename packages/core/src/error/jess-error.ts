import { type IRecognitionException, type ILexingResult } from 'chevrotain';
import type { TreeContext } from '../context.js';
import type { LocationInfo } from '../tree/node.js';
import { type JessErrorCode, type Phase, type Severity, resolveTemplate } from './codes.js';
import { lineColAt } from './code-frame.js';

type JessFile = TreeContext['file'];

/** Minimal shape for passing context and a node to helpers. */
export type TreeContextLike = { file: JessFile };

/** Node type carrying a source span. */
export type LocNode = { location?: LocationInfo; spanStart?: number; spanEnd?: number };

/**
 * Initialization bag for a diagnostic.
 * Prefer passing `ctx` + `node` so file/line/column/source are auto-wired.
 * If those aren't available, provide `filePath`/`source`/`line`/`column` directly.
 */
export type JessErrorInit = {
  severity?: Severity;
  code: JessErrorCode;
  phase: Phase;

  /** Optional: auto-wire file/line/col/source from compiler context + node */
  ctx?: TreeContextLike;
  node?: LocNode;

  /** Manual overrides if ctx/node aren't provided */
  filePath?: string;
  source?: string;
  line?: number;
  column?: number;

  /** Interpolation values for the selected template */
  meta?: Record<string, unknown>;

  /** Optional overrides for the template's strings */
  summary?: string;
  reason?: string;
  fix?: string;

  /** Optional one-liner for extra context */
  note?: string;

  /** Raw parser/lexer error data */
  errors?: ReadonlyArray<IRecognitionException | JessError>;
  lexerErrors?: ILexingResult['errors'];
};

/**
 * A normalized compiler diagnostic (error or warning) for any phase.
 *
 * `toString()` yields a plain, dependency-light message (header + reason + fix);
 * rich terminal rendering — code frames, clickable links, display tiers — is the
 * CLI's job (`@jesscss/jess` `outputDiagnostics`), driven off `toDiagnostic()`.
 */
export class JessError extends Error {
  severity: Severity = 'error';
  code: JessErrorCode = 'parse/syntax-error';
  phase: Phase = 'parse';

  // Resolved source context (fileObj preferred; filePath is legacy)
  fileObj?: JessFile;
  filePath?: string;
  line = 1;
  column = 1;
  source?: string;
  node?: LocNode; // Store node to derive endLine/endColumn on demand

  reason = '';
  fix = '';
  note?: string;

  errors?: ReadonlyArray<IRecognitionException | JessError>;
  lexerErrors?: ILexingResult['errors'];

  constructor(init: JessErrorInit) {
    // Resolve context from ctx/node first, else from explicit fields.
    const fileObj = init.ctx?.file;
    const source = fileObj?.source ?? init.source;
    // Line/col derive from the node's source offset + source (not stored on nodes).
    const nodeOffset = init.node?.spanStart;
    const derived = nodeOffset !== undefined && source !== undefined
      ? lineColAt(source, nodeOffset)
      : undefined;

    const t = resolveTemplate(init.code, init.meta ?? {});
    super(init.summary ?? t.summary);

    this.name = 'JessError';
    this.severity = init.severity ?? 'error';
    this.code = init.code;
    this.phase = init.phase;

    this.fileObj = fileObj;
    this.filePath = fileObj?.fullPath ?? init.filePath;
    this.line = derived?.line ?? init.line ?? 1;
    this.column = derived?.column ?? init.column ?? 1;
    this.source = source;
    this.node = init.node;

    this.reason = init.reason ?? t.reason;
    this.fix = init.fix ?? t.fix;
    this.note = init.note;

    this.errors = init.errors;
    this.lexerErrors = init.lexerErrors;
  }

  /** Plain-text diagnostic: header + reason/fix. No colors, links, or frame. */
  override toString(): string {
    const loc = this.filePath ? `${this.filePath}:${this.line}:${this.column}` : '(unknown)';
    return [
      `${this.severity} ${this.code} [${this.phase}] ${loc} — ${this.message}`,
      `Reason: ${this.reason}`,
      `Fix: ${this.fix}`,
      this.note ? `Note: ${this.note}` : undefined
    ].filter(Boolean).join('\n');
  }
}
