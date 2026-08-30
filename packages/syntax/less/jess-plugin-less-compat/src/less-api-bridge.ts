import type { MaybePromise } from '@jesscss/awaitable-pipe';
import {
  defineFunction,
  emitValue,
  groupItems,
  HEX,
  makeColorRgb,
  makeDimension,
  makeKeyword,
  makeList,
  makeQuoted,
  sniffLiteral,
  type Fn,
  type PluginCallCtx,
  type PluginHost,
  type PluginRawArgument,
  type ValueGroup,
  type Value
} from '@jesscss/core';
export type NativeLessFunction = (...args: unknown[]) => unknown;
export type ContextualPluginFunction = (
  args: readonly unknown[],
  capabilities: {
    lookupVariable?(name: string): { value: unknown; important?: boolean } | null;
    callFunction?(name: string, args: unknown[]): unknown;
    currentFileInfo?: { filename: string; entryPath: string };
    log?(record: { level: string; message: string }): void;
    markImportant?(): void;
  }
) => unknown | Promise<unknown>;

export type NativeLessPlugin = {
  readonly name?: string;
  readonly opts?: unknown;
  install?(less: NativeLessApi, manager: undefined, functions: NativeLessFunctionRegistry): void;
};

export interface NativeLessFunctionRegistry {
  add(name: string, fn: NativeLessFunction): void;
  addMultiple(functions: Record<string, NativeLessFunction>): void;
  get(name: string): NativeLessFunction | undefined;
}

export interface NativeLessApi {
  functions: { functionRegistry: NativeLessFunctionRegistry };
  tree: {
    Dimension: new (value: number, unit?: string) => NativeLessDimension;
    Quoted: new (quote: string, value: string, escaped?: boolean) => NativeLessQuoted;
    Color: new (rgb: string | readonly [number, number, number], alpha?: number) => NativeLessColor;
    Anonymous: new (value: unknown) => NativeLessAnonymous;
  };
}

export interface NativeLessDimension {
  readonly type: 'Dimension';
  readonly value: number;
  readonly unit: string;
  valueOf(): number;
}

export interface NativeLessQuoted {
  readonly type: 'Quoted';
  readonly quote: string;
  readonly value: string;
  readonly escaped: boolean;
  valueOf(): string;
}

export interface NativeLessColor {
  readonly type: 'Color';
  readonly rgb: string | readonly [number, number, number];
  readonly alpha: number;
  readonly value: string;
  valueOf(): string;
}

export interface NativeLessAnonymous {
  readonly type: 'Anonymous';
  readonly value: string;
  valueOf(): string;
}

type LoadedPluginModule = {
  readonly functions?: Record<string, ContextualPluginFunction>;
};

type PluginModuleLoader = (request: Parameters<NonNullable<PluginHost['loadPlugin']>>[0]) => MaybePromise<unknown>;
type PluginHostOptions = {
  readonly loadPluginModule?: PluginModuleLoader;
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function';

function isLoadedPluginModule(value: unknown): value is LoadedPluginModule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('functions' in value) || value.functions === undefined) {
    return true;
  }
  return typeof value.functions === 'object'
    && value.functions !== null
    && Object.values(value.functions).every(fn => typeof fn === 'function');
}

type NativeNil = { readonly type: 'Nil'; readonly value: ''; eval(): NativeNil };

const nativeNil = (): NativeNil => {
  const nil: NativeNil = { type: 'Nil', value: '', eval: () => nil };
  return nil;
};

class LessDimension implements NativeLessDimension {
  readonly type = 'Dimension';

  constructor(readonly value: number, readonly unit = '') {}

  valueOf(): number {
    return this.value;
  }
}

class LessQuoted implements NativeLessQuoted {
  readonly type = 'Quoted';

  constructor(readonly quote: string, readonly value: string, readonly escaped = false) {}

  valueOf(): string {
    return this.value;
  }
}

class LessColor implements NativeLessColor {
  readonly type = 'Color';
  readonly value: string;

  constructor(readonly rgb: string | readonly [number, number, number], readonly alpha = 1) {
    this.value = typeof rgb === 'string'
      ? (rgb.startsWith('#') ? rgb : `#${rgb}`)
      : `rgb(${rgb.join(', ')})`;
  }

  valueOf(): string {
    return this.value;
  }
}

class LessAnonymous implements NativeLessAnonymous {
  readonly type = 'Anonymous';
  readonly value: string;

  constructor(value: unknown) {
    this.value = String(value);
  }

  valueOf(): string {
    return this.value;
  }
}

class LazyExpression {
  readonly type = 'Expression';
  #value: readonly unknown[] | undefined;

  constructor(private readonly source: readonly ValueGroup[]) {}

  get value(): readonly unknown[] {
    return this.#value ??= this.source.map(toNativeLessValue);
  }

  valueOf(): string {
    return emitValue(this.source);
  }
}

class LazyValueList {
  readonly type = 'Value';
  #value: readonly unknown[] | undefined;

  constructor(private readonly source: Extract<Value, { type: 'List' }>) {}

  get value(): readonly unknown[] {
    return this.#value ??= this.source.value.map(toNativeLessValue);
  }

  get separator(): ',' | '/' {
    return this.source.sep;
  }

  valueOf(): string {
    return this.source.bytes;
  }
}

class LazyDetachedDeclaration {
  readonly type = 'Declaration';
  #value: unknown;
  #hasValue = false;

  constructor(
    readonly name: string,
    private readonly source: ValueGroup
  ) {}

  get value(): unknown {
    if (!this.#hasValue) {
      this.#value = toNativeLessValue(this.source);
      this.#hasValue = true;
    }
    return this.#value;
  }

  eval(): this {
    return this;
  }
}

class LazyDetachedRuleset {
  readonly type = 'Mixin';
  readonly name = nativeNil();
  readonly args = nativeNil();
  #rules: readonly LazyDetachedDeclaration[] | undefined;

  constructor(private readonly source: Extract<PluginRawArgument, { type: 'DetachedRuleset' }>) {}

  get ruleset(): { readonly rules: readonly LazyDetachedDeclaration[] } {
    return { rules: this.rules };
  }

  get rules(): readonly LazyDetachedDeclaration[] {
    return this.#rules ??= this.source.rules.map(rule => new LazyDetachedDeclaration(rule.name, rule.value));
  }

  eval(): this {
    return this;
  }
}

function isRawSequence(value: PluginRawArgument | ValueGroup): value is readonly ValueGroup[] {
  return Array.isArray(value);
}

function isPluginDetached(value: PluginRawArgument | ValueGroup): value is Extract<PluginRawArgument, { type: 'DetachedRuleset' }> {
  return !isRawSequence(value) && value.type === 'DetachedRuleset';
}

export function toNativeLessValue(value: PluginRawArgument | ValueGroup): unknown {
  if (isRawSequence(value)) {
    return new LazyExpression(value);
  }
  if (isPluginDetached(value)) {
    return new LazyDetachedRuleset(value);
  }
  switch (value.type) {
    case 'Dimension': return new LessDimension(value.number, value.unit);
    case 'Quoted': return new LessQuoted(value.quote, value.value, value.escaped);
    case 'Color': return { type: 'Color', rgb: value.rgb, alpha: value.alpha, valueOf: () => value.bytes };
    case 'List':
      return value.sep === ',' || value.sep === '/'
        ? new LazyValueList(value)
        : new LessAnonymous(value.bytes);
    default: return new LessAnonymous(value.bytes);
  }
}

function isNativeValue(value: unknown): value is Value {
  return value !== null
    && typeof value === 'object'
    && 'bytes' in value
    && typeof value.bytes === 'string';
}

export function fromNativeLessValue(value: unknown): ValueGroup {
  if (isNativeValue(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return makeDimension(value);
  }
  if (typeof value === 'string') {
    return sniffLiteral(value);
  }
  if (value && typeof value === 'object') {
    const candidate = value as {
      type?: unknown;
      value?: unknown;
      unit?: unknown;
      quote?: unknown;
      escaped?: unknown;
      separator?: unknown;
      rgb?: unknown;
      alpha?: unknown;
      valueOf?: () => unknown;
    };
    if ((candidate.type === 'Dimension' || candidate.type === 'Num') && typeof candidate.value === 'number') {
      return makeDimension(candidate.value, typeof candidate.unit === 'string' ? candidate.unit : '');
    }
    if (candidate.type === 'Quoted' && typeof candidate.value === 'string') {
      return makeQuoted(candidate.value, candidate.quote === '\'' ? '\'' : '"', candidate.escaped === true);
    }
    if (candidate.type === 'Color') {
      if (Array.isArray(candidate.rgb)) {
        const [r = 0, g = 0, b = 0] = candidate.rgb.map(Number);
        const alpha = typeof candidate.alpha === 'number' ? candidate.alpha : 1;
        return makeColorRgb([r, g, b], alpha, HEX);
      }
      if (typeof candidate.rgb === 'string') {
        return sniffLiteral(candidate.rgb.startsWith('#') ? candidate.rgb : `#${candidate.rgb}`);
      }
    }
    if (candidate.type === 'Expression' && Array.isArray(candidate.value)) {
      return candidate.value.map(fromNativeLessValue);
    }
    if (candidate.type === 'Value' && Array.isArray(candidate.value)) {
      const separator = candidate.separator === '/' ? '/' : ',';
      return makeList(candidate.value.map(item => fromNativeLessValue(item)), separator);
    }
    if (typeof candidate.value === 'string') {
      return sniffLiteral(candidate.value);
    }
    if (typeof candidate.valueOf === 'function') {
      return sniffLiteral(String(candidate.valueOf()));
    }
  }
  return makeKeyword(value == null ? '' : String(value));
}

export class LessApiBridge {
  readonly less: NativeLessApi;
  readonly registry: NativeLessFunctionRegistry;
  readonly globalFns: readonly Fn[];
  #fns: Fn[] = [];
  #nativeFns = new WeakMap<Fn, NativeLessFunction>();
  #contextualFns = new WeakMap<Fn, ContextualPluginFunction>();
  #registered = new Map<string, NativeLessFunction>();

  constructor(plugins: readonly NativeLessPlugin[] = []) {
    this.registry = {
      add: (name, fn) => {
        this.addFunction(name, fn);
      },
      addMultiple: (functions) => {
        for (const [name, fn] of Object.entries(functions)) {
          this.registry.add(name, fn);
        }
      },
      get: name => this.#registered.get(name.toLowerCase())
    };
    this.less = {
      functions: { functionRegistry: this.registry },
      tree: {
        Dimension: LessDimension,
        Quoted: LessQuoted,
        Color: LessColor,
        Anonymous: LessAnonymous
      }
    };
    for (const plugin of plugins) {
      plugin.install?.(this.less, undefined, this.registry);
    }
    this.globalFns = this.#fns;
  }

  addFunction(name: string, fn: NativeLessFunction): Fn {
    const lowerName = name.toLowerCase();
    this.#registered.set(lowerName, fn);
    const adapted = defineFunction(lowerName, {
      variadic: true,
      params: [],
      body: value => this.invokeNativeFunction(fn, groupItems(value))
    });
    this.#nativeFns.set(adapted, fn);
    this.#fns.push(adapted);
    return adapted;
  }

  addContextualFunction(name: string, fn: ContextualPluginFunction): Fn {
    const lowerName = name.toLowerCase();
    const adapted = defineFunction(lowerName, {
      variadic: true,
      params: [],
      body: () => {
        throw new Error(`Less @plugin function "${name}" needs live plugin invocation capabilities; it cannot run through plain function dispatch.`);
      }
    });
    this.#contextualFns.set(adapted, fn);
    this.#fns.push(adapted);
    return adapted;
  }

  invokeNativeFunction(fn: NativeLessFunction, args: readonly PluginRawArgument[]): ValueGroup | Promise<ValueGroup> {
    const result = fn(...args.map(toNativeLessValue));
    return isThenable(result)
      ? Promise.resolve(result).then(fromNativeLessValue)
      : fromNativeLessValue(result);
  }

  invokeContextualFunction(
    fn: ContextualPluginFunction,
    args: readonly PluginRawArgument[],
    ctx: PluginCallCtx
  ): ValueGroup | Promise<ValueGroup> {
    const result = fn(args.map(toNativeLessValue), {
      lookupVariable: (name) => {
        const hit = ctx.lookupVariable(name);
        return hit === null ? null : { value: toNativeLessValue(hit.value), important: hit.important };
      },
      callFunction: (name, callArgs) => {
        const answer = ctx.callFunction(name, callArgs.map(fromNativeLessValue));
        return answer === undefined ? undefined : toNativeLessValue(answer);
      },
      currentFileInfo: ctx.currentFileInfo,
      log: record => ctx.log(record),
      markImportant: () => ctx.markImportant()
    });

    return isThenable(result)
      ? Promise.resolve(result).then(fromNativeLessValue)
      : fromNativeLessValue(result);
  }

  invokeRawFunction(fn: Fn, args: readonly PluginRawArgument[], ctx: PluginCallCtx): MaybePromise<ValueGroup | undefined> {
    const contextual = this.#contextualFns.get(fn);
    if (contextual) {
      return this.invokeContextualFunction(contextual, args, ctx);
    }
    const native = this.#nativeFns.get(fn);
    return native ? this.invokeNativeFunction(native, args) : undefined;
  }

  createPluginHost(optionsOrLoader?: PluginHostOptions | PluginModuleLoader): PluginHost {
    const loadPluginModule = typeof optionsOrLoader === 'function'
      ? optionsOrLoader
      : optionsOrLoader?.loadPluginModule;
    const host: PluginHost = {
      ...(this.globalFns.length === 0 ? {} : { globalFns: this.globalFns }),
      invokeRawFunction: (fn, args, ctx) => this.invokeRawFunction(fn, args, ctx)
    };
    if (loadPluginModule) {
      host.loadPlugin = (request) => {
        const loaded = loadPluginModule(request);
        const addLoaded = (module: unknown) => {
          const functions = isLoadedPluginModule(module) ? module.functions : undefined;
          if (!functions) {
            return [];
          }
          return Object.entries(functions).map(([name, fn]) => this.addContextualFunction(name, fn));
        };
        return isThenable(loaded) ? Promise.resolve(loaded).then(addLoaded) : addLoaded(loaded);
      };
    }
    return host;
  }
}
