import { defineType, Node, F_VISIBLE } from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import { Nil } from './nil.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { syncLog } from './util/__tests__/debug-log.js';

export enum ExtendFlag {
  /** Sass and Jess default */
  All = 0,
  /** Less default - must not be a partial selector match */
  Exact = 1
}

export type ExtendValue = {
  /** The current selector. By default is `&` */
  selector?: Selector;
  /** The target to extend */
  target: Selector;
  /**
   * Optional namespace scoping for extend targets.
   *
   * - `namespace: '*'` means "search all extend roots in this file (ignore namespace scoping)".
   * - `namespace: 'ns'` means "search the extend root(s) assigned to namespace `ns`".
   */
  namespace?: string;
  flag?: ExtendFlag;
};
/**
 * Extends selectors - parsed by Less as an independent statement
 * at the beginning of rules.
 *
 * @todo - figure out eval -- use Rules lookups
 * @note - there is some pseudo-code somewhere that smartly
 * registers selectors by a string code.
 */
export interface Extend extends Node<ExtendValue> {
  eval(context: Context): MaybePromise<Selector>;
}

export class Extend extends Node<ExtendValue> {
  type = 'Extend' as const;
  shortType = 'extend' as const;
  override state = 0b0000;

  // #region agent log
  private static __agentLogCount = 0;
  private static agentLog(context: Context, location: string, message: string, data: Record<string, unknown>) {
    if (process.env.DEBUG_EXTEND_BOOT !== 'true') {
      return;
    }
    if (Extend.__agentLogCount++ > 400) {
      return;
    }
    const filePath = context.treeContext?.file?.fullPath
      || (context.treeContext?.file?.path && context.treeContext?.file?.name
        ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
        : context.treeContext?.file?.path)
      || '';
    if (typeof filePath === 'string'
      && !filePath.includes('tests-unit/extend-exact')
    ) {
      return;
    }
    syncLog({
      sessionId: 'debug-session',
      runId: process.env.DEBUG_RUN_ID || 'pre-fix',
      hypothesisId: 'H5',
      location,
      message,
      data,
      timestamp: Date.now()
    });
  }
  // #endregion

  override valueOf() {
    return `$extend ${this.value.target.valueOf()}`;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { target, selector, flag, namespace } = this.value;
    const mark = w.mark();
    w.add('$extend');
    if (selector) {
      let out = w.capture(() => selector.toString(options)).trim();
      w.add(' ');
      w.add(out, selector);
      w.add(' ->');
    }
    let out = w.capture(() => target.toString(options)).trim();
    w.add(' ');
    if (namespace) {
      w.add(`${namespace}|`);
    }
    w.add(out, target);
    if (flag === ExtendFlag.Exact) {
      w.add(' !exact');
    }
    w.add(';');
    return w.getSince(mark);
  }

  // Don't preEval Extend - let it be evaluated in evalNode when the ruleset is in the frame
  // This ensures the ampersand resolves to the correct ruleset selector, not the parent frame

  override evalNode(context: Context): MaybePromise<Nil> {
    let { selector, target, flag } = this.value;

    const currentFrame = context.rulesetFrames.at(-1);

    // #region agent log
    Extend.agentLog(context, 'extend.ts:evalNode', 'extend-eval-enter', {
      hasSelector: !!selector,
      target: target.valueOf(),
      flag: flag ?? null,
      extendsCountBefore: context.extends.length,
      hasExtendRoot: !!context.extendRoots.getCurrentExtendRoot(),
      hasRulesetFrame: !!currentFrame
    });
    // #endregion

    // If selector is undefined, convert it to ampersand so it resolves to the ruleset's selector
    // If selector is already set to a non-ampersand (e.g., from a bubbled extend), keep it as-is
    // The parser sets the selector correctly when bubbling extends, so we should preserve it
    if (!selector) {
      // Set selector to ampersand - it will resolve to the current ruleset's selector when evaluated
      // This matches the conceptual model: .c:extend(.ext all) is like { &:extend(.ext all); } inside .c
      // The frame selector should already be :is(.a, .b) .c (the evaluated selector from preEval)
      selector = Ampersand.create(undefined);
      // Make the ampersand visible so it's included in the selector when evaluated
      // This ensures the parent selector is properly included in the extend selector
      selector.addFlag(F_VISIBLE);
    }
    // If selector is already set (e.g., .ext7 from a bubbled extend), use it directly
    // Don't convert non-ampersand selectors to ampersand - they should be used as-is
    // Get current extend root from registry stack
    const extendRoot = context.extendRoots.getCurrentExtendRoot();
    // #region agent log
    const filePathForH48 = context.treeContext?.file?.fullPath ?? '';
    if (typeof filePathForH48 === 'string' && filePathForH48.includes('extend-media')) {
      const targetV = target.valueOf();
      if (targetV === '.ext1') {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H48',
          location: 'extend.ts:evalNode',
          message: 'extend-root-check',
          data: {
            target: String(targetV),
            extendWith: selector ? String(selector.valueOf()) : 'ampersand',
            extendRootId: extendRoot ? String(extendRoot).substring(0, 80) : null,
            contextRootId: context.root ? String(context.root).substring(0, 80) : null,
            extendRootStackLength: context.extendRoots.extendRootStack.length
          },
          timestamp: Date.now()
        });
      }
    }
    // #endregion
    if (!extendRoot) {
      /** Throw error? */
      return new Nil();
    }

    const maybeSel = selector.eval(context);
    if (isThenable(maybeSel)) {
      return (maybeSel as Promise<Selector | Nil>).then((sel) => {
        if (sel instanceof Nil) {
          return new Nil();
        }
        // Resolve ampersand to its stored selector if needed
        let resolvedSel: Selector = sel;
        if (isNode(sel, 'Ampersand') && sel.value.selector && !(sel.value.selector instanceof Nil)) {
          resolvedSel = sel.value.selector;
        }
        // Register extend to context with extend root reference and Extend node for error reporting
        context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this]);
        // #region agent log
        const filePath = context.treeContext?.file?.fullPath ?? '';
        if (typeof filePath === 'string' && filePath.includes('extend-media')) {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H41',
            location: 'extend.ts:evalNode',
            message: 'extend-registered-async',
            data: {
              target: target.valueOf(),
              extendWith: resolvedSel.valueOf(),
              partial: flag === ExtendFlag.All,
              extendRootId: extendRoot ? String(extendRoot) : null,
              currentExtendRoot: context.extendRoots.getCurrentExtendRoot() ? String(context.extendRoots.getCurrentExtendRoot()) : null,
              extendsCountAfter: context.extends.length,
              extendsIndex: context.extends.length - 1
            },
            timestamp: Date.now()
          });
        }
        Extend.agentLog(context, 'extend.ts:evalNode', 'extend-registered', {
          target: target.valueOf(),
          resolvedSel: resolvedSel.valueOf(),
          partial: flag === ExtendFlag.All,
          extendsCountAfter: context.extends.length
        });
        // #endregion
        return new Nil();
      });
    }
    const sel = maybeSel as Selector | Nil;
    if (sel instanceof Nil) {
      return new Nil();
    }
    // Resolve ampersand to its stored selector if needed
    let resolvedSel: Selector = sel;
    const wasAmpersand = isNode(sel, 'Ampersand');
    const ampersandStoredSelector = wasAmpersand ? sel.value.selector : undefined;
    if (wasAmpersand && ampersandStoredSelector && !(ampersandStoredSelector instanceof Nil)) {
      resolvedSel = ampersandStoredSelector;
    }
    // Register extend to context with extend root reference and Extend node for error reporting
    context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this]);
    // #region agent log
    const filePath = context.treeContext?.file?.fullPath ?? '';
    if (typeof filePath === 'string' && filePath.includes('extend-media')) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'run',
        hypothesisId: 'H41',
        location: 'extend.ts:evalNode',
        message: 'extend-registered-sync',
        data: {
          target: target.valueOf(),
          extendWith: resolvedSel.valueOf(),
          partial: flag === ExtendFlag.All,
          extendRootId: extendRoot ? String(extendRoot) : null,
          currentExtendRoot: context.extendRoots.getCurrentExtendRoot() ? String(context.extendRoots.getCurrentExtendRoot()) : null,
          extendsCountAfter: context.extends.length,
          extendsIndex: context.extends.length - 1
        },
        timestamp: Date.now()
      });
    }
    Extend.agentLog(context, 'extend.ts:evalNode', 'extend-registered', {
      target: target.valueOf(),
      resolvedSel: resolvedSel.valueOf(),
      partial: flag === ExtendFlag.All,
      extendsCountAfter: context.extends.length
    });
    // #endregion
    return new Nil();
  }
}
export const extend = defineType(Extend, 'Extend');