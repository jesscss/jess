import {
  Declaration,
  type DeclarationValue,
  type DeclarationOptions
} from './declaration.js';
import { type AnyRole } from './any.js';
import { defineType, F_VISIBLE, type NodeLocation } from './node.js';
import type { LocationInfo } from './node-base.js';
import { Nil } from './nil.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type RenderBuffer, isRenderBuffer } from './util/render-buffer.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';

export type VarDeclarationOptions = DeclarationOptions & {
  paramVar?: boolean;

  /**
   * Live-binding ASSIGNMENT, written `$!foo: bar` — the `!` sigil right after `$`,
   * mirroring the `$!foo` read form's `readMode: 'snapshot'`. Records the `$!`
   * intent on the assignment node; it renders back as `$!name`.
   *
   * @todo eval — "assign through the live binding" is NOT implemented; the parser
   * accepts `$!foo:` and warns.
   */
  liveBinding?: boolean;
};

/**
 * @example
 *   Jess: `$foo: 1`
 *   Less: `@foo: 1`
 *   SCSS: `$foo: 1`
 *
 * @example `setDefined` — Sass `!global` / assign the global (top) binding
 *   SCSS: `$foo: 1 !global`
 *
 * @example `nearestOuter` — Jess `:=` / reassign the nearest enclosing binding
 *   Jess: `$foo := 1`  (nearest-outer non-shadowing)
 *
 * @example `liveBinding`
 *   Jess: `$!foo: 1`  (live-binding assignment; eval TODO)
 *
 * @todo Support destructuring
 * e.g. `$(var1, var2): 1 2`
 */
export class VarDeclaration extends Declaration<VarDeclarationOptions> {
  constructor(
    value: DeclarationValue<AnyRole>,
    options?: VarDeclarationOptions,
    location?: NodeLocation
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    super(value as DeclarationValue, options, location as LocationInfo | undefined);
    this.removeFlag(F_VISIBLE);

    /** Parameter declarations are not like var declarations */
    if (options?.paramVar) {
      this.addFlag(F_VISIBLE);
    }
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string | MaybePromise<string> {
    /*
     * A visible parameter var (e.g. `$tone`) is a signature element: it renders
     * its authored form directly and is never evaluated, prepared, or resolved.
     * Going through the Declaration eval/render path would both evaluate it and
     * recurse (its own value-state output is itself).
     */
    if (this._options?.paramVar && this.hasFlag(F_VISIBLE)) {
      return this.renderSource(context, bufferOrOptions, options);
    }
    return isRenderBuffer(bufferOrOptions)
      ? super.render(context, bufferOrOptions, options)
      : super.render(context, bufferOrOptions);
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    if (this._options?.paramVar && this.value instanceof Nil) {
      this.writeBareParameterSyntax(options);
      return w.getSince(position);
    }
    this.writeSyntax(options);
    return w.getSince(position);
  }

  private writeBareParameterSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$', this);
    if (typeof this.name === 'string') {
      w.add(this.name.replace(/\s+$/u, ''), this);
      return;
    }
    const nameMark = w.mark();
    this.name.writeSyntax(options);
    w.trimEndSince(nameMark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    if (this._options?.paramVar && this.value instanceof Nil) {
      this.writeBareParameterSyntax(options);
      return;
    }
    const w = options.writer;
    w.add('$', this);

    // Live-binding assignment `$!foo: …` — emit the `!` sigil after `$`.
    if (this._options?.liveBinding) {
      w.add('!', this);
    }
    const before = w.mark();
    const s = this.declTrimmedString(options);
    const emitted = w.getSince(before);
    if (!emitted && s) {
      w.add(s);
    }
  }
}
defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');

export const vardecl = (
  value: DeclarationValue<AnyRole>,
  options?: VarDeclarationOptions,
  location?: NodeLocation
) => new VarDeclaration(value, options, location).parentChildren();
