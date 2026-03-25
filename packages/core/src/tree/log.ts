import { type Context } from '../context.js';
import { Node, F_VISIBLE, defineType, type OptionalLocation, type NodeOptions, type TreeContext } from './node.js';
import { Nil } from './nil.js';
import { logger } from '../logger.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export type LogLevel = 'debug' | 'warn' | 'error';

export type LogValue = {
  level: LogLevel;
  message: Node;
};

export interface Log extends Node<LogValue, NodeOptions> {
  type: 'Log';
  shortType: 'log';
  eval(context: Context): MaybePromise<Nil>;
}

/**
 * A log node for diagnostic at-rules (@debug, @warn, @error).
 * These are compile-time diagnostic directives that should not appear in CSS output.
 */
export class Log extends Node<LogValue, NodeOptions> {
  static override childKeys = ['level', 'message'] as const;

  level!: LogLevel;
  message!: Node;

  constructor(
    value: LogValue,
    options?: NodeOptions,
    location?: OptionalLocation,
    treeContext?: TreeContext
  ) {
    super(value as any, options, location, treeContext);
    this.level = value.level;
    this.message = value.message;
    if (this.message instanceof Node) {
      this.adopt(this.message);
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.removeFlag(F_VISIBLE);
  }

  override toTrimmedString() {
    return '';
  }

  override toString() {
    return '';
  }

  override evalNode(context: Context): MaybePromise<Nil> {
    const messageResult = this.message.eval(context);

    if (messageResult && typeof (messageResult as any).then === 'function') {
      return (messageResult as Promise<Node>).then((evaluatedMessage) => {
        this._logMessage(evaluatedMessage);
        return new Nil();
      });
    }

    this._logMessage(messageResult as Node);
    return new Nil();
  }

  private _logMessage(msg: Node): void {
    const messageStr = String(msg);
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
