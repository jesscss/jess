import { defineType, type LocationInfo, type Node } from './node.js';
import { type TreeContext } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { compare } from './util/compare.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { quoted } from './quoted.js';
import { pipe, isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { syncLog } from './util/__tests__/debug-log.js';

export type AttributeSelectorValue = {
  /** The name of the attribute */
  name: string | Node;
  /** The operator */
  op?: string;
  /** The value of the attribute */
  value?: Node;
  /** The modifier (case insensitivity) */
  mod?: string;
};

/**
 * An attribute selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
 *   e.g. [id="foo"]
*/
export class AttributeSelector extends SimpleSelector<AttributeSelectorValue> {
  type = 'AttributeSelector' as const;
  shortType = 'attr' as const;

  override evalNode(context: Context): MaybePromise<this> {
    // #region agent log
    const __agentDbg = process.env.DEBUG_EXTEND_BOOT === 'true';
    const __agentFilePath = __agentDbg
      ? (context.treeContext?.file?.fullPath
        || (context.treeContext?.file?.path && context.treeContext?.file?.name
          ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
          : context.treeContext?.file?.path)
        || '')
      : '';
    const __agentShouldLog = __agentDbg
      && typeof __agentFilePath === 'string'
      && __agentFilePath.includes('tests-unit/extend-selector')
      && this.value.value instanceof Any
      && typeof this.value.value.value === 'string'
      && this.value.value.value.includes('@{');
    if (__agentShouldLog) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H11',
        location: 'selector-attr.ts:evalNode',
        message: 'attr-evalNode-enter',
        data: {
          attrName: typeof this.value.name === 'string' ? this.value.name : this.value.name.type,
          op: this.value.op ?? null,
          rawValue: this.value.value instanceof Any ? this.value.value.value : null
        },
        timestamp: Date.now()
      });
    }
    // #endregion
    return pipe(
      () => {
        // #region agent log
        if (__agentShouldLog) {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'pre-fix',
            hypothesisId: 'H11',
            location: 'selector-attr.ts:evalNode',
            message: 'attr-super-enter',
            data: {},
            timestamp: Date.now()
          });
        }
        // #endregion
        return super.evalNode(context) as any;
      },
      () => {
        // #region agent log
        if (__agentShouldLog) {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'pre-fix',
            hypothesisId: 'H11',
            location: 'selector-attr.ts:evalNode',
            message: 'attr-super-exit',
            data: {},
            timestamp: Date.now()
          });
        }
        // #endregion
        const { value } = this.value;
        // #region agent log
        if (__agentShouldLog) {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'pre-fix',
            hypothesisId: 'H11',
            location: 'selector-attr.ts:evalNode',
            message: 'attr-after-super',
            data: {
              valueType: (value as any)?.type ?? null,
              valueIsAny: value instanceof Any,
              valueStr: value instanceof Any ? value.value : null
            },
            timestamp: Date.now()
          });
        }
        // #endregion
        // Handle Less interpolation that the parser may have left as a raw token in selectors:
        //   [data=@{attr-data}]
        // In Less semantics this should resolve to the variable value and be serialized quoted.
        if (value instanceof Any && typeof value.value === 'string') {
          const raw = value.value.trim();
          const m = raw.match(/^@\{([^}]+)\}$/);
          if (m) {
            const key = m[1]!;
            // #region agent log
            if (__agentShouldLog) {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                hypothesisId: 'H11',
                location: 'selector-attr.ts:evalNode',
                message: 'attr-before-rulesParent',
                data: { key },
                timestamp: Date.now()
              });
            }
            // #endregion
            const rules = this.rulesParent;
            // #region agent log
            if (__agentShouldLog) {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                hypothesisId: 'H11',
                location: 'selector-attr.ts:evalNode',
                message: 'attr-after-rulesParent',
                data: { key, hasRules: !!rules },
                timestamp: Date.now()
              });
            }
            // #endregion
            // #region agent log
            if (process.env.DEBUG_EXTEND_BOOT === 'true') {
              const filePath = context.treeContext?.file?.fullPath
                || (context.treeContext?.file?.path && context.treeContext?.file?.name
                  ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
                  : context.treeContext?.file?.path)
                || '';
              if (typeof filePath === 'string' && filePath.includes('tests-unit/extend-selector')) {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                  hypothesisId: 'H11',
                  location: 'selector-attr.ts:evalNode',
                  message: 'attr-interp-enter',
                  data: {
                    attrName: typeof this.value.name === 'string' ? this.value.name : this.value.name.type,
                    raw,
                    key,
                    hasRules: !!rules
                  },
                  timestamp: Date.now()
                });
              }
            }
            // #endregion
            if (rules) {
              // #region agent log
              if (__agentShouldLog) {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                  hypothesisId: 'H11',
                  location: 'selector-attr.ts:evalNode',
                  message: 'attr-find-enter',
                  data: { key },
                  timestamp: Date.now()
                });
              }
              // #endregion
              const found = rules.find('declaration', key, 'VarDeclaration');
              // #region agent log
              if (__agentShouldLog) {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                  hypothesisId: 'H11',
                  location: 'selector-attr.ts:evalNode',
                  message: 'attr-find-exit',
                  data: { key, found: !!found, foundIsArray: Array.isArray(found) },
                  timestamp: Date.now()
                });
              }
              // #endregion
              const decl = Array.isArray(found) ? found[0] : found;
              if (decl && isNode(decl, 'VarDeclaration')) {
                // #region agent log
                if (process.env.DEBUG_EXTEND_BOOT === 'true') {
                  const filePath = context.treeContext?.file?.fullPath
                    || (context.treeContext?.file?.path && context.treeContext?.file?.name
                      ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
                      : context.treeContext?.file?.path)
                    || '';
                  if (typeof filePath === 'string' && filePath.includes('tests-unit/extend-selector')) {
                    syncLog({
                      sessionId: 'debug-session',
                      runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                      hypothesisId: 'H11',
                      location: 'selector-attr.ts:evalNode',
                      message: 'attr-interp-found',
                      data: {
                        key,
                        foundIsArray: Array.isArray(found),
                        declType: decl.type,
                        declValueType: (decl.value.value as any)?.type ?? null
                      },
                      timestamp: Date.now()
                    });
                  }
                }
                // #endregion
                // #region agent log
                if (__agentShouldLog) {
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                    hypothesisId: 'H11',
                    location: 'selector-attr.ts:evalNode',
                    message: 'attr-var-eval-enter',
                    data: { key },
                    timestamp: Date.now()
                  });
                }
                // #endregion
                const out = decl.value.value.eval(context);
                if (isThenable(out)) {
                  return (out as Promise<Node>).then((evaluated) => {
                    // #region agent log
                    if (process.env.DEBUG_EXTEND_BOOT === 'true') {
                      const filePath = context.treeContext?.file?.fullPath
                        || (context.treeContext?.file?.path && context.treeContext?.file?.name
                          ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
                          : context.treeContext?.file?.path)
                        || '';
                      if (typeof filePath === 'string' && filePath.includes('tests-unit/extend-selector')) {
                        syncLog({
                          sessionId: 'debug-session',
                          runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                          hypothesisId: 'H11',
                          location: 'selector-attr.ts:evalNode',
                          message: 'attr-interp-eval-async',
                          data: { key, out: String((evaluated as any)?.valueOf?.() ?? '') },
                          timestamp: Date.now()
                        });
                      }
                    }
                    // #endregion
                    // #region agent log
                    if (__agentShouldLog) {
                      syncLog({
                        sessionId: 'debug-session',
                        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                        hypothesisId: 'H11',
                        location: 'selector-attr.ts:evalNode',
                        message: 'attr-var-eval-exit-async',
                        data: { key },
                        timestamp: Date.now()
                      });
                    }
                    // #endregion
                    this.value.value = quoted(String(evaluated.valueOf()));
                    this._valueOf = undefined;
                    this._keySet = undefined;
                    this._visibleKeySet = undefined;
                    this._canFastReject = undefined;
                    return this;
                  });
                }
                // #region agent log
                if (process.env.DEBUG_EXTEND_BOOT === 'true') {
                  const filePath = context.treeContext?.file?.fullPath
                    || (context.treeContext?.file?.path && context.treeContext?.file?.name
                      ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
                      : context.treeContext?.file?.path)
                    || '';
                  if (typeof filePath === 'string' && filePath.includes('tests-unit/extend-selector')) {
                    syncLog({
                      sessionId: 'debug-session',
                      runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                      hypothesisId: 'H11',
                      location: 'selector-attr.ts:evalNode',
                      message: 'attr-interp-eval-sync',
                      data: { key, out: String(((out as Node) as any)?.valueOf?.() ?? '') },
                      timestamp: Date.now()
                    });
                  }
                }
                // #endregion
                // #region agent log
                if (__agentShouldLog) {
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                    hypothesisId: 'H11',
                    location: 'selector-attr.ts:evalNode',
                    message: 'attr-var-eval-exit',
                    data: { key },
                    timestamp: Date.now()
                  });
                }
                // #endregion
                this.value.value = quoted(String((out as Node).valueOf()));
                this._valueOf = undefined;
                this._keySet = undefined;
                this._visibleKeySet = undefined;
                this._canFastReject = undefined;
              }
            }
          }
        }
        return this;
      }
    );
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { name, op, value, mod } = this.value;
    w.add('[');
    if (typeof name === 'string') {
      w.add(name, this);
    } else {
      name.toString(options);
    }
    if (op) {
      w.add(op);
    }
    if (value) {
      value.toString(options);
    }
    if (mod) {
      w.add(' ');
      w.add(mod);
    }
    w.add(']');
    return w.getSince(mark);
  }

  override valueOf() {
    let valueOf = this._valueOf;
    if (!valueOf) {
      let { name, op, value, mod } = this.value;
      /** Attributes are case-insensitive */
      let keyStr = (typeof name === 'string' ? name : name.toTrimmedString()).toLowerCase();
      if (!op) {
        return `[${keyStr}]`;
      }
      let valueStr = value?.valueOf() ?? '';
      valueOf = this._valueOf = `[${keyStr}${op}"${valueStr}"${mod ? ` ${mod}` : ''}]`;
    }
    return valueOf;
  }
}

/** Not sure why types couldn't be properly inferred */
export const attr = defineType<AttributeSelectorValue>(AttributeSelector, 'AttributeSelector', 'attr') as (
  value: AttributeSelectorValue,
  options?: undefined,
  location?: LocationInfo | 0,
  treeContext?: TreeContext
) => AttributeSelector;