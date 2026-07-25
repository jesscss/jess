import { describe, it, expect } from 'vitest';
import { isThenable } from '@jesscss/awaitable-pipe';
import { el } from '../../index.js';
import { OutputWriter } from '../../util/print.js';
import {
  bufferSubjectDecls,
  composeSubjectHeader,
  flushBufferedSubject,
  type BufferedSubject
} from '../spine-extend.js';

/**
 * COMPONENT RATCHET — the buffer-then-flush mechanism (§4.4.1/§4.4.2), proven in ISOLATION
 * on hand-built subjects before it meets the corpus (P3 increment 1).
 *
 * The mechanism has two halves with opposite dependencies (§4.4.1): the DECLS are resolved
 * live and PARKED during descent (captured via `writer.preview`, which rolls the writer
 * back so nothing streams under the not-yet-final header); the HEADER is composed ONCE at
 * flush from the settled contributions and spliced `[header ++ open ++ decls ++ close]`.
 *
 * These tests pin the EXACT eval-path byte shape for the simplest reaching-extend shape
 * (root-level, non-partial, single-target, no crossing) — captured from the live compiler:
 *
 *   `.a { color: red } .b:extend(.a) { color: blue }`  →
 *     `.a,\n.b {\n  color: red;\n}\n`   (target `.a` header gains branch `.b`, `,\n`-joined)
 *     `.b {\n  color: blue;\n}\n`       (the extender's OWN block, unchanged, at its position)
 *
 * A regression in the compose/join/splice or the async-safe capture trips these RED.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.4.1 (value/selector split), §4.4.2 (baseline flush)
 */
describe('spine buffer-then-flush mechanism (P3 increment 1)', () => {
  /*
   * The simplest reaching-extend subject: target `.a` (order 0) gaining extender `.b`
   * (order 1). Both are root-level bucket paths of length 1 — no crossing, no nesting.
   */
  const subjectShape = (decls: string): BufferedSubject => ({
    targetPath: [el('.a')],
    order: 0,
    contributions: [{ path: [el('.b')], order: 1 }],
    decls,
    open: ' {\n',
    close: '}\n'
  });

  it('composes the target header with the extender branch, `,\\n`-joined (byte shape)', () => {
    const { header, hoistToRoot } = composeSubjectHeader(subjectShape(''));
    expect(header).toBe('.a,\n.b');
    expect(hoistToRoot).toBe(false);
  });

  it('flushes `[header ++ open ++ decls ++ close]` byte-identical to the eval path', () => {
    const block = flushBufferedSubject(subjectShape('  color: red;\n'));
    expect(block).toBe('.a,\n.b {\n  color: red;\n}\n');
  });

  it('composes a single-branch header (no reaching extend) verbatim', () => {
    const { header } = composeSubjectHeader({
      targetPath: [el('.a')],
      order: 0,
      contributions: [],
      decls: '',
      open: ' {\n',
      close: '}\n'
    });
    expect(header).toBe('.a');
  });

  it('SYNC capture: preview parks decl bytes and rolls the writer back (nothing streams)', () => {
    const writer = new OutputWriter(false);
    writer.add('BEFORE');
    const captured = bufferSubjectDecls(writer, () => {
      writer.add('  color: red;\n');
    });

    // Sync path returns the captured bytes directly...
    expect(captured).toBe('  color: red;\n');

    // ...and the writer was rolled back to BEFORE (the decls did NOT stream).
    expect(writer.toString()).toBe('BEFORE');
  });

  it('ASYNC capture: preview parks bytes written in a later microtask, rolls back only AFTER settle', async () => {
    const writer = new OutputWriter(false);
    writer.add('BEFORE');

    /*
     * An async body (the calc()/alpha() case): the write lands in a LATER microtask. The
     * capture MUST wait for that write, then roll back — never restore early (the B1s bug).
     */
    const capturedMaybe = bufferSubjectDecls(writer, async () => {
      await Promise.resolve();
      writer.add('  width: 10px;\n');
    });
    expect(isThenable(capturedMaybe)).toBe(true);
    const captured = await capturedMaybe;

    // The async bytes were captured (proving the rollback did NOT run before the write)...
    expect(captured).toBe('  width: 10px;\n');

    // ...and the writer rolled back cleanly afterward (the async bytes did NOT leak into output).
    expect(writer.toString()).toBe('BEFORE');
  });

  it('end-to-end: buffer decls live, then flush at the target position (baseline §4.4.2)', () => {
    const writer = new OutputWriter(false);

    /*
     * The extender `.b`'s own block streams first (extender-before-target document order is
     * possible; here we emit the target block via the buffered path).
     */
    const capturedMaybe = bufferSubjectDecls(writer, () => {
      writer.add('  color: red;\n');
    });

    // Sync body → sync capture (not a promise); guard rather than assert the type.
    expect(isThenable(capturedMaybe)).toBe(false);
    const captured = isThenable(capturedMaybe) ? '' : capturedMaybe;
    const block = flushBufferedSubject(subjectShape(captured));
    writer.add(block);
    expect(writer.toString()).toBe('.a,\n.b {\n  color: red;\n}\n');
  });

  it('fails loud on a crossing (hoistToRoot) subject — not wired at increment 1', () => {
    const crossing: BufferedSubject = {
      // extender `.footer .footer-nav` crosses the target `.header`'s parent boundary.
      targetPath: [el('.header'), el('.header-nav')],
      order: 0,
      contributions: [{ path: [el('.footer'), el('.footer-nav')], order: 1 }],
      decls: '  color: red;\n',
      open: ' {\n',
      close: '}\n'
    };
    expect(composeSubjectHeader(crossing).hoistToRoot).toBe(true);
    expect(() => flushBufferedSubject(crossing)).toThrow(/hoistToRoot not wired/);
  });
});
