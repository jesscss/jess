import { type Context } from '../context.js';
import { Node, defineType, type LocationInfo } from './node.js';
import { Selector } from './selector.js';
import { Rules, resolveRulesetBySelector } from './rules.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { createCallableRulesSurface } from './util/callable-surface.js';
import { sourceSpanOf } from './util/provenance.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

export interface Apply extends Node<Selector[]> {
  eval(context: Context): MaybePromise<Rules>;
}

/**
 * Jess `$apply <selector-list>` — merges the listed rulesets' bodies into the
 * current rule. `$apply .foo` applies ONLY plain `Ruleset`s (`.foo {}`), matched
 * on the whole selector, and merges in ALL matching `.foo {}` blocks (merge-all).
 * Parametric `Mixin`s (`.foo() {}`) are NEVER applied — `$apply` deliberately does
 * not touch the args/guards callable machinery (that is `$ > .foo()`).
 *
 * Kept first-class in the AST (round-trips `$apply .a, .b;` structurally). At eval
 * it expands, via the same thin-surface / live-binding mechanic a mixin call uses
 * to inline its rules, into a `Rules` container of the matched rulesets' bodies —
 * a LIVE binding to the referenced rulesets, not a frozen copy (see `evalNode`).
 */
export class Apply extends Node<Selector[]> {
  static override childKeys = ['selectors'] as const;

  readonly selectors: Selector[];

  constructor(value: Selector[], options?: undefined, location?: LocationInfo, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.selectors = value;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$apply ', this);
    // Comma-space separated on one line (`$apply .a, .b;`) — NOT the `,\n` list
    // emission the CSS selector-list serializer uses.
    this.selectors.forEach((selector, i) => {
      if (i > 0) {
        w.add(', ');
      }
      selector.writeSyntax(options);
    });
    w.add(';', this);
  }

  override valueOf(): string {
    return `$apply ${this.selectors.map(s => String(s.valueOf())).join(', ')}`;
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    // `$apply` is invisible in CSS output on its own — eval expands it into the
    // applied rules. A stray render (unevaluated) falls back to the authored surface.
    const printOptions = isRenderBuffer(bufferOrOptions) ? options : bufferOrOptions;
    return this.toTrimmedString(printOptions);
  }

  /**
   * Expand `$apply` into a `Rules` surface of the matched rulesets' bodies, using
   * the SAME thin-surface / live-binding mechanic a mixin call uses to inline its
   * rules (`createCallableRulesSurface`): each target selector is resolved
   * ruleset-only (whole-selector, merge-all) against the active scope, and for
   * every matched `Ruleset` a thin surface is created that SHARES the ruleset's
   * canonical body children (push-without-adopt) and points `sourceNode` at the
   * ruleset — so the applied rules are a LIVE binding to the referenced rulesets,
   * not a frozen copy. The thin surfaces are collected into one container `Rules`
   * that stands in for the `$apply` position; its output flattens into the parent
   * (same merge mechanic control-flow rules use).
   */
  override evalNode(context: Context): MaybePromise<Rules> {
    const scope = isNode(context.rulesContext, N.Rules) ? context.rulesContext : context.root;

    const surfaces: Node[] = [];
    for (const selector of this.selectors) {
      for (const ruleset of resolveRulesetBySelector(selector, scope)) {
        // Thin surface: shares the ruleset's body children + live `sourceNode`
        // binding back to the ruleset (mirrors the mixin-call inline path).
        surfaces.push(createCallableRulesSurface(ruleset));
      }
    }

    const container = new Rules(
      [],
      undefined,
      sourceSpanOf(this),
      this.sourceRoot?._treeContext
    ).inherit(this);
    for (const surface of surfaces) {
      // Share the thin surface WITHOUT adopting (keep the live binding intact).
      container.rules.push(surface);
    }

    return container.eval(context);
  }
}

export const apply = defineType(Apply, 'Apply', 'apply');
