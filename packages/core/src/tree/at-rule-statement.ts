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

export type AtRuleStatementParts = {
  name: string | AtRuleStatementValue['name'];
  prelude?: string | Node;
};

export type AtRuleStatementOptions = NodeOptions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

// AUDIT: How the fuck can a statement have a comment child?
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

// AUDIT: Why?
function isAtRuleWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

// AUDIT: Why?
function hasNonAtRuleWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isAtRuleWhitespace(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

// AUDIT: Why?
function startsWithAtRuleWhitespace(text: string): boolean {
  return text.length > 0 && isAtRuleWhitespace(text.charCodeAt(0));
}

// AUDIT: Why???? WHY SO MANY OF THESE???
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
export class AtRuleStatement extends Node<AtRuleStatementValue | AtRuleStatementParts, AtRuleStatementOptions> {
  static override childKeys = ['name', 'prelude'] as const;
  override allowRoot = true;

  protected _valueOf: string | undefined;
  name: AtRuleStatementParts['name'];
  prelude: AtRuleStatementParts['prelude'];

  constructor(
    value: AtRuleStatementValue | AtRuleStatementParts,
    options?: AtRuleStatementOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    if (typeof value.name === 'string' && !/^@[a-zA-Z][\w-]*$/u.test(value.name)) {
      throw new TypeError('At-rule statement name is outside the scanner-native at-rule subset.');
    }
    this.name = value.name;
    this.prelude = value.prelude;
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
    ...this.materializeHeaderForSemantics(),
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

  private materializeHeaderForSemantics(): AtRuleStatementValue {
    if (typeof this.name === 'string') {
      const name = new Any(this.name, { role: 'atkeyword' }, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
        .inherit(this);
      this.adopt(name);
      this.name = name;
      this.value.name = name;
    }
    if (typeof this.prelude === 'string') {
      const prelude = new Any(this.prelude, undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
        .inherit(this);
      this.adopt(prelude);
      this.prelude = prelude;
      this.value.prelude = prelude;
    }
    this._valueOf = undefined;
    return { name: this.name, prelude: this.prelude };
  }

  override valueOf() {
    return (this._valueOf ??= (
      (typeof this.name === 'string' ? this.name : this.name.valueOf())
      + (this.prelude ? ' ' + (typeof this.prelude === 'string' ? this.prelude : this.prelude.valueOf()) : '')
    ));
  }

  private evalPreludeValue(prelude: Node, context: Context): MaybePromise<Node> {
    return withRulesContext(
      context,
      liftedAtRulePreludeRulesContext(context.rulesContext),
      () => prelude.eval(context)
    );
  }

  override evalNode(context: Context): MaybePromise<AtRuleStatement> {
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
    if (typeof this.name === 'string') {
      return this.prelude instanceof Node
        ? finishName(this.materializeHeaderForSemantics().name)
        : this;
    }
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

  // AUDIT: toString() & toTrimmedString() should not track cursors. They should just serialize.
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer!.mark();
    this.writeSyntax(options);
    return options.writer!.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    if (typeof this.name === 'string') {
      w.add(indent(options.depth));
      w.add(this.name, this);
      if (typeof this.prelude === 'string' && hasNonAtRuleWhitespace(this.prelude)) {
        if (!endsWithAtRuleWhitespace(this.name) && !startsWithAtRuleWhitespace(this.prelude)) {
          w.add(' ');
        }
        w.add(this.prelude, this);
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
