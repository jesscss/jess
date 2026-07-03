import { type Context } from '../context.js';
import { Node, F_VISIBLE, defineType, type LocationInfo, type NodeOptions } from './node.js';
import { createPublicNil, Nil } from './nil.js';
import { logger } from '../logger.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';
import {
  type RenderBuffer,
  renderInvisibleEffect
} from './util/render-buffer.js';

export type LogLevel = 'debug' | 'warn' | 'error';

export type LogValue = {
  level: LogLevel;
  message: Node;
};

export interface Log extends Node<LogValue, NodeOptions> {
  eval(context: Context): MaybePromise<Nil>;
}

/**
 * A log node for diagnostic at-rules (@debug, @warn, @error).
 * These are compile-time diagnostic directives that should not appear in CSS output.
 */
export class Log extends Node<LogValue, NodeOptions> {
  static override childKeys = ['level', 'message'] as const;

  readonly level: LogLevel;
  readonly message: Node;

  constructor(
    value: LogValue,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this.level = value.level;
    this.message = value.message;
    this._treeContext = treeContext;
    // Log nodes should not be visible (they serialize to empty strings)
    this.removeFlag(F_VISIBLE);
  }

  override toTrimmedString() {
    // Log nodes serialize to empty string since they're not supported in Jess syntax
    return '';
  }

  /** @internal */
  override writeSyntax(_options: FinalPrintOptions): void {}

  private runLogEffect(context: Context): MaybePromise<void> {
    const messageResult = this.message.eval(context);
    if (isThenable(messageResult)) {
      return messageResult.then((evaluatedMessage) => {
        this._logMessage(evaluatedMessage);
      });
    }
    this._logMessage(messageResult);
  }

  override evalNode(context: Context): MaybePromise<Nil> {
    const effect = this.runLogEffect(context);
    return isThenable(effect)
      ? effect.then(createPublicNil)
      : createPublicNil();
  }

  override resolve(context: Context): MaybePromise<Nil> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string | MaybePromise<string> {
    return renderInvisibleEffect(this.runLogEffect(context), bufferOrOptions);
  }

  private _logMessage(message: Node): void {
    const messageStr = String(message);
    const { level } = this;

    switch (level) {
      case 'debug':
        logger.log?.(messageStr);
        break;
      case 'warn':
        logger.warn?.(messageStr);
        break;
      case 'error':
        logger.error?.(messageStr);
        break;
    }
  }
}

export const log = defineType(Log, 'Log');
