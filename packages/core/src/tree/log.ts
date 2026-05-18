import { type Context } from '../context.js';
import { Node, F_VISIBLE, defineType, type LocationInfo, type NodeOptions, type TreeContext } from './node.js';
import { Nil } from './nil.js';
import { logger } from '../logger.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { PrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeMaybeRenderedOutput
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
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(
    value: LogValue,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext);
    // Log nodes should not be visible (they serialize to empty strings)
    this.removeFlag(F_VISIBLE);
  }

  override toTrimmedString() {
    // Log nodes serialize to empty string since they're not supported in Jess syntax
    return '';
  }

  override toString() {
    return '';
  }

  override evalNode(context: Context): MaybePromise<Nil> {
    // Evaluate the message expression
    const messageResult = this.value.message.eval(context);

    // Handle async evaluation if needed
    if (isThenable(messageResult)) {
      return (messageResult as Promise<Node>).then((evaluatedMessage) => {
        this._logMessage(evaluatedMessage);
        return new Nil();
      });
    }

    // Synchronous evaluation
    this._logMessage(messageResult as Node);
    return new Nil();
  }

  override resolve(context: Context): MaybePromise<Nil> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeMaybeRenderedOutput(bufferOrOptions, this.evalNode(context), context, options);
    }
    return super.render(context, bufferOrOptions);
  }

  private _logMessage(message: Node): void {
    const messageStr = String(message);
    const { level } = this.value;

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
