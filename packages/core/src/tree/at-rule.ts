import { Node, defineType, F_STATIC, type NodeOptions, type LocationInfo } from './node';
import { Ruleset } from './ruleset';
import type { Any } from './any';
import { Rules } from './rules';
import type { Context, TreeContext } from '../context';
import { type PrintOptions, getPrintOptions, findDepthMarker, withChildDepth } from './util/print';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { Ampersand } from './ampersand';
import { isNode } from './util/is-node';
import { Nil } from './nil';

export type AtRuleValue = {
  name: Any<'atkeyword'>;
  /** The prelude */
  prelude?: Node;
  rules?: Rules;
};

export type AtRuleOptions = NodeOptions & {
  /** Whether it will bubble outside selectors inside when collapsing nesting */
  nestable?: boolean;
};

/**
 * A rule like @charset or @media
 */
export class AtRule extends Node<AtRuleValue, AtRuleOptions> {
  type = 'AtRule' as const;
  shortType = 'atrule' as const;
  override allowRoot = true;

  constructor(value: AtRuleValue, options?: AtRuleOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    /** Normally set by parser, but convenience for API */
    if (
      options?.nestable === undefined
    ) {
      let name = value.name.value;
      if (['@media', '@supports', '@layer', '@container', '@scope'].includes(name)) {
        this.options.nestable = true;
      }
    }
  }

  frames: (Ruleset | AtRule)[] | undefined;

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { name, prelude, rules } = this.value;
    const mark = w.mark();

    if (this.options.hoistToRoot) {
      if (rules) {
        // renderWithFrameFlattening will add this at-rule to frameState when it renders it
        rules.renderWithFrameFlattening(options, this);
        return w.getSince(mark);
      }
    }

    // frameState is guaranteed to exist by getPrintOptions
    const frameState = options.frameState!;
    // Use options.depth if provided (set by parent), otherwise calculate based on hoisting
    let currentDepth = options.depth;
    if (currentDepth === undefined) {
      if (this.options.hoistToRoot) {
        // Hoisted at-rules: check if we're inside another hoisted at-rule
        const lastAtRuleFrame = frameState.filter(s => s?.frame?.type === 'AtRule').at(-1);
        if (lastAtRuleFrame?.frame && (lastAtRuleFrame.frame as AtRule).options.hoistToRoot) {
          // Inside a hoisted at-rule - nestable at-rules should use parent's depth (stay at same level)
          currentDepth = lastAtRuleFrame.depth;
        } else {
          // At root level - hoisted at-rules start at depth 0
          currentDepth = 0;
        }
      } else {
        // Non-hoisted: if no depth provided, we're at root (depth 0)
        currentDepth = 0;
      }
    }
    // #region agent log
    // eslint-disable-next-line @typescript-eslint/naming-convention
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'at-rule.ts:88', message: 'AtRule currentDepth calculation', data: { hoistToRoot: this.options.hoistToRoot, calculatedCurrentDepth: currentDepth, optionsDepth: options.depth, frameStateLength: frameState.length, hasAtRuleFrames: frameState.some(s => s?.frame?.type === 'AtRule'), lastFrameDepth: frameState[frameState.length - 1]?.depth, lastFrameHasFrame: !!frameState[frameState.length - 1]?.frame, collapseNesting: options.collapseNesting }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'depth-refactor', hypothesisId: 'A' }) }).catch(() => {});
    // #endregion
    
    // Push this at-rule to frameState for frame tracking (not for depth)
    frameState.push({ frame: this, depth: currentDepth });
    // Set depth for renderOpening and children
    const renderOptions = { ...options, frameState, depth: currentDepth };
    // #region agent log
    // eslint-disable-next-line
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'at-rule.ts:103', message: 'AtRule pushing to frameState', data: { currentDepth, frameStateLength: frameState.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'depth-refactor', hypothesisId: 'D' }) }).catch(() => {});
    // #endregion
    this.renderOpening(renderOptions);

    if (rules) {
      // Set depth for children (rules.toBraced) - children should be one level deeper
      const childOptions = { ...renderOptions, depth: currentDepth + 1 };
      rules.toBraced(childOptions);
    } else {
      w.add(';');
    }
    
    // Pop the at-rule we added to frameState
    frameState.pop();

    return w.getSince(mark);
  }

  /** Render the opening of this at-rule (name and prelude) */
  renderOpening(options: PrintOptions): void {
    const w = options.writer!;
    const { name, prelude, rules } = this.value;
    // Use options.depth if provided (set by parent), otherwise we're at root (depth 0)
    const depth = options.depth ?? 0;
    // #region agent log
    // eslint-disable-next-line
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'at-rule.ts:121', message: 'AtRule renderOpening', data: { depth, optionsDepth: options.depth }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'depth-refactor', hypothesisId: 'D' }) }).catch(() => {});
    // #endregion
    w.add(''.padStart(depth * 2));
    const nameOut = name.toString(options);
    // 3. See if name endsWith whitespace (any whitespace character)
    const nameEndsWithSpace = /\s$/.test(nameOut);
    if (prelude) {
      const preludeOut = w.capture(() => prelude.toString(options));

      // 4. See if prelude startsWith whitespace (any whitespace character)
      const preludeStartsWithSpace = /^\s/.test(preludeOut);

      // IF NEITHER, OUTPUT WITH ONE SPACE
      if (!nameEndsWithSpace && !preludeStartsWithSpace) {
        w.add(' ');
      }
      // Emit prelude (with leading space removed)
      w.add(preludeOut);
      if (rules) {
        const preludeEndsWithSpace = /\s$/.test(preludeOut);
        if (!preludeEndsWithSpace) {
          w.add(' ');
        }
      }
    } else {
      if (!nameEndsWithSpace && rules) {
        w.add(' ');
      }
    }
  }

  override evalNode(context: Context): MaybePromise<AtRule> {
    let node = this as AtRule;

    // Store frames snapshot for collapseNesting serialization
    if (context.opts.collapseNesting || node.options.hoistToRoot) {
      node.frames = [...context.frames];
    }

    return pipe(
      () => {
        let { prelude } = node.value;
        if (prelude) {
          if (prelude.hasFlag(F_STATIC)) {
            prelude.evaluated = true;
          } else {
            let out = prelude.eval(context);
            if (isThenable(out)) {
              return (out as Promise<Node>).then((n) => {
                node.value.prelude = n;
                return node;
              });
            }
            node.value.prelude = out;
          }
        }
      },
      () => {
        let { rules } = node.value;
        if (rules) {
          node.options.hoistToRoot ||= context.opts.collapseNesting;
          context.frames.push(node);
          if (node.options.nestable && node.options.hoistToRoot) {
            let existingRules = rules;
            rules = Rules.create([
              Ruleset.create({
                selector: Ampersand.create(undefined),
                rules: existingRules
              })
            ]).inherit(existingRules);
            rules.parent = node;
          }

          // Register extend root for nestable at-rules (including @layer)
          let pushedExtendRoot = false;
          if (node.options.nestable) {
            const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
            // Extract layer name for @layer at-rules
            let layerName: string | undefined;
            const atRuleName = node.value.name?.toTrimmedString?.() ?? node.value.name?.toString?.() ?? '';
            if (atRuleName === '@layer' && node.value.prelude) {
              const preludeStr = node.value.prelude.toTrimmedString?.() ?? node.value.prelude.toString?.() ?? '';
              if (preludeStr) {
                // Check if parent has a layer name and concatenate
                const parentLayerName = parentExtendRoot ? context.extendRoots.getLayerName(parentExtendRoot) : undefined;
                layerName = parentLayerName ? `${parentLayerName}.${preludeStr}` : preludeStr;
              }
            }
            context.extendRoots.registerRoot(rules, parentExtendRoot, { layerName });
            context.extendRoots.pushExtendRoot(rules);
            pushedExtendRoot = true;
          }

          let onlyRuleSetChild = isNode(rules.value[0], 'Ruleset');

          let out = rules.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Rules>).then((r) => {
              // If the only rule was a ruleset, and it evaluated to Rules,
              // discard the extra rules wrapper
              if (onlyRuleSetChild && isNode(r.value[0], 'Rules')) {
                node.value.rules = r.value[0];
              } else {
                node.value.rules = r;
              }
              if (pushedExtendRoot) {
                context.extendRoots.popExtendRoot();
              }
              return node;
            });
          }
          if (onlyRuleSetChild && isNode(out.value[0], 'Rules')) {
            node.value.rules = out.value[0];
          } else {
            node.value.rules = out;
          }
          if (pushedExtendRoot) {
            context.extendRoots.popExtendRoot();
          }
        }
        return node;
      },
      () => {
        context.frames.pop();
        return node;
      }
    ) as MaybePromise<AtRule>;
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(`${this.name}`, this.location)
  //   /** Prelude expression includes white space */
  //   const value = this.value
  //   if (value) {
  //     value.toCSS(context, out)
  //   }
  //   if (this.rules) {
  //     this.rules.toCSS(context, out)
  //   } else {
  //     out.add(';')
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.atrule({\n', this.location)
  //   const pre = context.pre
  //   context.indent++
  //   out.add(`${pre}  name: ${JSON.stringify(this.name)}`)
  //   const value = this.value
  //   if (value) {
  //     out.add(`,\n${pre}  value: `)
  //     value.toModule(context, out)
  //   }
  //   const rules = this.rules
  //   if (rules) {
  //     out.add(`,\n${pre}  rules: `)
  //     rules.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n${pre}},${JSON.stringify(this.location)})`)
  // }
}

export const atrule = defineType(AtRule, 'AtRule');