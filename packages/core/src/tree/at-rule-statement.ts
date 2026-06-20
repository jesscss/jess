import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { Anonymous, Any, Keyword } from './any.js';
import { Interpolated } from './interpolated.js';
import { Node, defineType, F_STATIC, type LocationInfo, type NodeOptions } from './node.js';
import { OutputWriter, getPrintOptions, prepareRenderPrintState, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { createTriviaMap, emitCommentTriviaBetweenNodes, emitCommentTriviaAfterNode, emitNodeSourceSyntaxWithTrivia } from './util/trivia.js';
import { copyWithReusableLeaves, reuseLeaf, canReuseLeaf } from './util/cloning.js';
import { withRulesContext } from './util/context.js';
import { indent } from './util/serialize-helper.js';

export type AtRuleStatementValue = {
  name: Any | Interpolated;
  prelude?: Node;
};

export type RawAtRuleStatementValue = {
  name: string;
  prelude?: string;
};

export type AtRuleStatementOptions = NodeOptions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasCommentChild(value: unknown): boolean {
  if (value instanceof Node && value.type === 'Comment') {
    return true;
  }
  if (value instanceof Node) {
    return hasCommentChild(value.value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (hasCommentChild(value[i])) {
        return true;
      }
    }
    return false;
  }
  if (isRecord(value)) {
    for (const key in value) {
      if (hasCommentChild(value[key])) {
        return true;
      }
    }
  }
  return false;
}

function atRuleScalarTokenText(node: Node): string | undefined {
  return (
    node.constructor === Any
    || node.constructor === Anonymous
    || node.constructor === Keyword
  )
    ? node.value
    : undefined;
}

function renderAtRuleStatementNodeSyntax(
  node: Node,
  printOptions: FinalPrintOptions,
  withoutComments?: boolean
): string {
  const scalarText = atRuleScalarTokenText(node);
  if (scalarText !== undefined) {
    return scalarText;
  }
  const savedTrivia = printOptions.trivia;
  if (withoutComments) {
    printOptions.trivia = createTriviaMap();
  }
  try {
    const writer = new OutputWriter(printOptions.compress);
    emitNodeSourceSyntaxWithTrivia(node, {
      ...printOptions,
      writer
    });
    return writer.toString();
  } finally {
    printOptions.trivia = savedTrivia;
  }
}

function isAtRuleWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function hasNonAtRuleWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isAtRuleWhitespace(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

function startsWithAtRuleWhitespace(text: string): boolean {
  return text.length > 0 && isAtRuleWhitespace(text.charCodeAt(0));
}

function endsWithAtRuleWhitespace(text: string): boolean {
  return text.length > 0 && isAtRuleWhitespace(text.charCodeAt(text.length - 1));
}

function trimAtRuleLeadingWhitespace(text: string, replacement = ''): string {
  let index = 0;
  while (index < text.length && isAtRuleWhitespace(text.charCodeAt(index))) {
    index++;
  }
  return index === 0 ? text : replacement + text.slice(index);
}

function trimAtRuleTrailingWhitespace(text: string): string {
  let end = text.length;
  while (end > 0 && isAtRuleWhitespace(text.charCodeAt(end - 1))) {
    end--;
  }
  return end === text.length ? text : text.slice(0, end);
}

function renderBetweenNameAndPreludeTrivia(
  name: Node,
  prelude: Node,
  printOptions: FinalPrintOptions
): string {
  const writer = new OutputWriter(printOptions.compress);
  emitCommentTriviaBetweenNodes(name, prelude, {
    ...printOptions,
    writer
  });
  return writer.toString();
}

function renderPostPreludeTrivia(
  prelude: Node,
  printOptions: FinalPrintOptions
): string {
  const writer = new OutputWriter(printOptions.compress);
  emitCommentTriviaAfterNode(prelude, {
    ...printOptions,
    writer
  });
  return writer.toString();
}

function liftedAtRulePreludeRulesContext(rulesContext: Context['rulesContext']): Context['rulesContext'] {
  let cursor = rulesContext;
  let depth = 0;
  while (cursor?.parent && depth++ < 10) {
    const parent = cursor.parent;
    const grandparent = parent.parent;
    if (parent.type === 'AtRule' && grandparent?.type === 'Rules') {
      cursor = grandparent;
      continue;
    }
    break;
  }
  return cursor;
}

/**
 * A semicolon at-rule with no body, such as `@charset`, `@import`, or
 * statement-form `@layer`.
 */
export class AtRuleStatement extends Node<AtRuleStatementValue | RawAtRuleStatementValue, AtRuleStatementOptions> {
  static override childKeys = ['name', 'rawName', 'prelude', 'rawPrelude'] as const;
  override allowRoot = true;

  protected _valueOf: string | undefined;
  name: AtRuleStatementValue['name'] | undefined;
  rawName: string | undefined;
  prelude: AtRuleStatementValue['prelude'];
  rawPrelude: string | undefined;

  constructor(
    value: AtRuleStatementValue | RawAtRuleStatementValue,
    options?: AtRuleStatementOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    if (typeof value.name === 'string') {
      if (!/^@[a-zA-Z][\w-]*$/u.test(value.name)) {
        throw new TypeError('Raw at-rule statement name is outside the scanner-native at-rule subset.');
      }
      this.name = undefined;
      this.rawName = value.name;
      this.prelude = undefined;
      this.rawPrelude = value.prelude;
    } else {
      this.name = value.name;
      this.rawName = undefined;
      this.prelude = value.prelude;
      this.rawPrelude = undefined;
    }
    this._treeContext = treeContext;
  }

  private ownName(name: AtRuleStatementValue['name']): AtRuleStatementValue['name'] {
    const owned = canReuseLeaf(name) ? reuseLeaf(name) : copyWithReusableLeaves(name);
    if (!(owned instanceof Any) && !(owned instanceof Interpolated)) {
      throw new TypeError('Expected at-rule statement name copy');
    }
    return owned;
  }

  private ownNode(node: Node): Node {
    return canReuseLeaf(node) ? reuseLeaf(node) : copyWithReusableLeaves(node);
  }

  deriveAtRuleStatement(parts: AtRuleStatementValue, sourceParts: AtRuleStatementValue = {
    ...this.materializeRawHeaderForSemantics(),
    prelude: this.prelude
  }): AtRuleStatement {
    return new AtRuleStatement(
      {
        name: parts.name === sourceParts.name ? this.ownName(parts.name) : parts.name,
        prelude: parts.prelude && parts.prelude === sourceParts.prelude ? this.ownNode(parts.prelude) : parts.prelude
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  private materializeRawHeaderForSemantics(): AtRuleStatementValue {
    if (this.name !== undefined) {
      return { name: this.name, prelude: this.prelude };
    }
    const rawName = this.rawName;
    if (rawName === undefined) {
      throw new TypeError('AtRuleStatement requires a name before semantic materialization.');
    }
    const name = new Any(rawName, { role: 'atkeyword' }, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
      .inherit(this);
    this.adopt(name);
    this.name = name;
    this.rawName = undefined;
    this.value.name = name;
    const rawPrelude = this.rawPrelude;
    if (rawPrelude !== undefined) {
      const prelude = new Any(rawPrelude, undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
        .inherit(this);
      this.adopt(prelude);
      this.prelude = prelude;
      this.rawPrelude = undefined;
      this.value.prelude = prelude;
    }
    this._valueOf = undefined;
    return { name, prelude: this.prelude };
  }

  override valueOf() {
    return (this._valueOf ??= this.rawName !== undefined
      ? this.rawName + (this.rawPrelude ? ' ' + this.rawPrelude : '')
      : (this.name!.valueOf() + (this.prelude ? ' ' + this.prelude.valueOf() : '')));
  }

  private evalPreludeValue(prelude: Node, context: Context): MaybePromise<Node> {
    return withRulesContext(
      context,
      liftedAtRulePreludeRulesContext(context.rulesContext),
      () => prelude.eval(context)
    );
  }

  override evalNode(context: Context): MaybePromise<AtRuleStatement> {
    if (this.rawName !== undefined) {
      return this;
    }
    const finishName = (name: Node): MaybePromise<AtRuleStatement> => {
      if (!(name instanceof Any) && !(name instanceof Interpolated)) {
        throw new TypeError('Expected at-rule statement name to resolve to Any or Interpolated');
      }
      if (!this.prelude) {
        return this.deriveAtRuleStatement({ name });
      }
      const prelude = this.evalPreludeValue(this.prelude, context);
      const finishPrelude = (resolvedPrelude: Node): AtRuleStatement => this.deriveAtRuleStatement({
        name,
        prelude: resolvedPrelude
      });
      return isThenable(prelude)
        ? prelude.then(finishPrelude)
        : finishPrelude(prelude);
    };
    const evaluatedName = this.name instanceof Interpolated ? this.name.eval(context) : this.name;
    return isThenable(evaluatedName)
      ? evaluatedName.then(finishName)
      : finishName(evaluatedName);
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.evaluated || this.hasFlag(F_STATIC)) {
      return this;
    }
    return this.eval(context);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer!.mark();
    this.writeSyntax(options);
    return options.writer!.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    if (this.rawName !== undefined) {
      w.add(indent(options.depth));
      w.add(this.rawName, this);
      if (this.rawPrelude !== undefined && hasNonAtRuleWhitespace(this.rawPrelude)) {
        if (!endsWithAtRuleWhitespace(this.rawName) && !startsWithAtRuleWhitespace(this.rawPrelude)) {
          w.add(' ');
        }
        w.add(this.rawPrelude, this);
      }
      w.add(';');
      return;
    }
    let { name, prelude } = this;
    if (hasCommentChild(name) || hasCommentChild(prelude)) {
      name = this.ownName(name);
      if (prelude) {
        prelude = this.ownNode(prelude);
      }
    }
    const nameOut = renderAtRuleStatementNodeSyntax(name, options);
    w.add(indent(options.depth));
    w.add(nameOut, name);
    if (prelude) {
      const preludeOut = renderAtRuleStatementNodeSyntax(prelude, options);
      if (hasNonAtRuleWhitespace(preludeOut)) {
        const interstitialTrivia = renderBetweenNameAndPreludeTrivia(name, prelude, options);
        if (interstitialTrivia) {
          w.add(interstitialTrivia);
          w.add(trimAtRuleLeadingWhitespace(preludeOut), prelude);
        } else {
          const nameEndsWithSpace = endsWithAtRuleWhitespace(nameOut);
          const preludeStartsWithSpace = startsWithAtRuleWhitespace(preludeOut);
          if (preludeStartsWithSpace) {
            w.add(trimAtRuleLeadingWhitespace(preludeOut, nameEndsWithSpace ? '' : ' '), prelude);
          } else if (!nameEndsWithSpace) {
            w.add(' ');
            w.add(preludeOut, prelude);
          } else {
            w.add(preludeOut, prelude);
          }
        }
        const preludePost = renderPostPreludeTrivia(prelude, options);
        if (preludePost) {
          w.add(preludePost);
        }
      }
    }
    w.add(';');
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): MaybePromise<string> {
    const node = this.eval(context);
    const finish = (resolved: Node): string => {
      const printOptions = isRenderBuffer(bufferOrOptions)
        ? prepareBufferPrintState(context, options)
        : prepareRenderPrintState(context, bufferOrOptions);
      const writer = printOptions.writer;
      const mark = writer.mark();
      resolved.writeSyntax(printOptions);
      const rendered = trimAtRuleTrailingWhitespace(writer.getSince(mark));
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderText(bufferOrOptions, rendered)
        : rendered;
    };
    return isThenable(node)
      ? node.then(finish)
      : finish(node);
  }
}

export const atrulestatement = defineType(AtRuleStatement, 'AtRuleStatement', 'atrulestatement');
