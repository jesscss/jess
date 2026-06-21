import isPlainObject from 'lodash-es/isPlainObject.js';
import { AbstractClass, Class, OmitIndexSignature } from 'type-fest';
import { isNode } from './tree/util/is-node.js';
import { N } from './tree/node-type.js';
import type { Context } from './context.js';
import { isThenable } from '@jesscss/awaitable-pipe';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { List, Dimension } from './tree/index.js';
import type { ConversionPlugin, PreprocessParams } from './conversions.js';
export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
export type ArgType = PrimitiveType | Class<any> | AbstractClass<any>;
export type Lazy<T> = () => MaybePromise<T>;

/**
 * FunctionThis provides the function execution context.
 *
 * The `args` property is always a function that returns a `MaybePromise<List>`,
 * providing a consistent API regardless of lazy parameter configuration.
 *
 * @example
 * ```typescript
 * const func = defineFunction('test', async function(this: FunctionThis) {
 *   // this.args is always a function that returns the arguments
 *   const evaluatedArgs = await this.args();
 *   return evaluatedArgs;
 * }, {
 *   params: [
 *     { name: 'value', type: 'string', lazy: true }
 *   ]
 * });
 * ```
 */
export type FunctionThis = {
  /** The evaluation context */
  context: Context;
  /** The current call node that invoked this function, when available. */
  caller?: Context['caller'];
  /**
   * The function arguments. Always returns a function that evaluates to MaybePromise<List>.
   * This provides a consistent API regardless of lazy parameter configuration.
   */
  args: () => MaybePromise<List>;
  /** The original arguments, not evaluated */
  rawArgs: List;
};

export type RawArgsPlacementState = {
  source: unknown;
  sourceArgs: List;
};

const rawArgsPlacements = new WeakMap<List, RawArgsPlacementState>();

export function setRawArgsPlacement(rawArgs: List, placement: RawArgsPlacementState): void {
  rawArgsPlacements.set(rawArgs, placement);
}

export function getRawArgsPlacement(rawArgs: List): RawArgsPlacementState | undefined {
  return rawArgsPlacements.get(rawArgs);
}

export type ParamDefinition = {
  name: string;
  type: ArgType | readonly ArgType[];
  optional?: boolean;
  default?: any;
  /** Marks this parameter as a variadic rest parameter. Must be the last param. */
  rest?: boolean;
  /** If true, provide a thunk (() => Promise<T>) to the internal positional function */
  lazy?: boolean;
  /** Conversion plugins to apply to the argument before passing to the function */
  convert?: ConversionPlugin[];
};

export type DefineFunctionOptions = {
  /**
   * Parameter definitions. Can be a single array for one signature,
   * or an array of arrays for function overloading (multiple signatures).
   * The system will try each signature until one matches.
   */
  params: readonly ParamDefinition[] | readonly ParamDefinition[][];
  /**
   * Preprocesses the raw arguments array before parsing into a record.
   * This allows transformations like splitting sequences, normalizing arguments, etc.
   * Applied in order, with each preprocessor receiving the output of the previous one.
   *
   * @param args - The raw arguments array
   * @param context - The evaluation context
   * @returns The processed arguments array (can be async)
   */
  preprocessParams?: PreprocessParams[];
  // Future options can be added here
  // example?: boolean;
  // validate?: boolean;
};

// Helper type to get the inferred type from ArgType
type GetArgType<T extends ArgType> =
  T extends 'string'
    ? string
    : T extends 'number'
      ? number
      : T extends 'boolean'
        ? boolean
        : T extends 'null'
          ? null
          : T extends 'undefined'
            ? undefined
            : T extends Class<any> | AbstractClass<any>
              ? InstanceType<T>
              : never;

// Helper type to get the inferred type from a parameter definition, accounting for lazy
type GetParamType<T extends DefineFunctionOptions['params'][number]> =
  T extends { lazy: true; type: infer A extends ArgType }
    ? Lazy<GetArgType<A>>
    : T extends { lazy: true; type: readonly ArgType[] }
      ? Lazy<GetArgType<T['type'][number]>>
      : T extends { type: infer A extends ArgType }
        ? GetArgType<A>
        : T extends { type: readonly ArgType[] }
          ? GetArgType<T['type'][number]>
          : never;

/** This should be getting only required types but it doesn't? */
type GetBaseRecordType<T extends DefineFunctionOptions['params']> = (
  OmitIndexSignature<{
    [K in keyof T as T[K] extends { optional: true } | { default: any }
      ? never
      : T[K] extends { name: infer N extends string }
        ? N
        : never]:
    T[K] extends DefineFunctionOptions['params'][number]
      ? GetParamType<T[K]>
      : never;
  }>
);

type GetOptionalRecordType<T extends DefineFunctionOptions['params']> = {
  [K in keyof T as T[K] extends { optional: true } | { default: any }
    ? T[K] extends { name: infer N extends string }
      ? N
      : never
    : never]?:
  T[K] extends { rest: true }
    ? (
        T[K] extends DefineFunctionOptions['params'][number]
          ? GetParamType<T[K]>[]
          : never
      )
    : (
        T[K] extends DefineFunctionOptions['params'][number]
          ? GetParamType<T[K]>
          : never
      );
};

// Get record types for named parameters
type GetRecordType<T extends DefineFunctionOptions['params']> = (
   GetOptionalRecordType<T> & Omit<GetBaseRecordType<T>, keyof GetOptionalRecordType<T>>
);

type GetPositionalTypes<
  T extends DefineFunctionOptions['params'],
  P extends Partial<GetRecordType<DefineFunctionOptions['params']>> = Partial<GetRecordType<T>>
> = T extends readonly [infer First, ...infer Rest]
  ? Rest extends DefineFunctionOptions['params']
    ? First extends { optional: true } | { default: any }
      ? First extends DefineFunctionOptions['params'][number]
        ? [(GetParamType<First> | (P & GetRecordType<T>))?, ...GetPositionalTypes<Rest, P>]
        : never
      : First extends DefineFunctionOptions['params'][number]
        ? [GetParamType<First> | (P & GetRecordType<T>), ...GetPositionalTypes<Rest, P>]
        : never
    : []
  : [];

/**
 * Validates that the internal function signature matches the params definition
 */
type ValidateFunctionSignature<F extends (...args: any[]) => any> = F;

export type RuntimeFunction = ((...args: any[]) => any) & {
  options?: DefineFunctionOptions;
  _internal?: (...args: any[]) => any;
};

type DefineFunctionCallable<
  T extends DefineFunctionOptions,
  F extends (...args: any[]) => any
> = {
  (...args: GetPositionalTypes<T['params']>): ReturnType<F>;
  (record: GetRecordType<T['params']>): ReturnType<F>;
  name: string;
  params: T['params'];
} & (
  // Overloads for 1 parameter
  T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional: true }]
    ? {
        (): ReturnType<F>;
        (arg1: GetPositionalTypes<T['params']>[0]): ReturnType<F>;
      }
    : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }]
      ? {
          (arg1: GetPositionalTypes<T['params']>[0]): ReturnType<F>;
        }
      // Overloads for 2 parameters
      : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional: true }, { name: string; type: ArgType | readonly ArgType[]; optional: true }]
        ? {
            (): ReturnType<F>;
            (arg1: GetPositionalTypes<T['params']>[0]): ReturnType<F>;
            (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1]): ReturnType<F>;
          }
        : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional: true }]
          ? {
              (arg1: GetPositionalTypes<T['params']>[0]): ReturnType<F>;
              (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1]): ReturnType<F>;
            }
          : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }]
            ? {
                (arg1: GetPositionalTypes<T['params']>[0]): ReturnType<F>;
                (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1]): ReturnType<F>;
              }
            // Overloads for 3 parameters
            : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional: true }]
              ? {
                  (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1]): ReturnType<F>;
                  (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2]): ReturnType<F>;
                }
              : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }]
                ? {
                    (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2]): ReturnType<F>;
                  }
                // Overloads for 4 parameters
                : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional: true }]
                  ? {
                      (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2]): ReturnType<F>;
                      (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2], arg4: GetPositionalTypes<T['params']>[3]): ReturnType<F>;
                    }
                  : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }]
                    ? {
                        (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2], arg4: GetPositionalTypes<T['params']>[3]): ReturnType<F>;
                      }
                    // Overloads for 5 parameters
                    : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional: true }]
                      ? {
                          (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2], arg4: GetPositionalTypes<T['params']>[3]): ReturnType<F>;
                          (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2], arg4: GetPositionalTypes<T['params']>[3], arg5: GetPositionalTypes<T['params']>[4]): ReturnType<F>;
                        }
                      : T['params'] extends readonly [{ name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }, { name: string; type: ArgType | readonly ArgType[]; optional?: boolean }]
                        ? {
                            (arg1: GetPositionalTypes<T['params']>[0], arg2: GetPositionalTypes<T['params']>[1], arg3: GetPositionalTypes<T['params']>[2], arg4: GetPositionalTypes<T['params']>[3], arg5: GetPositionalTypes<T['params']>[4]): ReturnType<F>;
                          }
                        // Fallback for 6+ parameters - no strong typing for positions 6+
                        : T['params']['length'] extends number
                          ? T['params']['length'] extends 0 | 1 | 2 | 3 | 4 | 5
                            ? {}
                            : {
                                (...args: any[]): ReturnType<F>;
                              }
                          : {}
);

/**
 * Public callable returned by `defineFunction`.
 *
 * This named export keeps TypeScript declaration emit from inventing fragile
 * inferred private return types while preserving the rich positional/record
 * overloads used by function authors.
 */
export type DefinedFunction<
  T extends DefineFunctionOptions,
  F extends (...args: any[]) => any
> = DefineFunctionCallable<T, F> & RuntimeFunction & {
  /** @todo - This inference is not working correctly - fix later */
  call(thisArg: any, ...args: Parameters<DefineFunctionCallable<T, F>>): ReturnType<F>;
  apply(thisArg: any, args: Parameters<DefineFunctionCallable<T, F>>): ReturnType<F>;
};

function isOverloadedParams(params: DefineFunctionOptions['params']): params is readonly ParamDefinition[][] {
  return Array.isArray(params) && params.length > 0 && Array.isArray(params[0]);
}

function normalizeParamSignatures(params: DefineFunctionOptions['params'] | undefined): ParamDefinition[][] {
  if (!params) {
    return [];
  }
  if (isOverloadedParams(params)) {
    const out = new Array<ParamDefinition[]>(params.length);
    for (let i = 0; i < params.length; i++) {
      const sig = params[i]!;
      const copy = new Array<ParamDefinition>(sig.length);
      for (let j = 0; j < sig.length; j++) {
        copy[j] = sig[j]!;
      }
      out[i] = copy;
    }
    return out;
  }
  const copy = new Array<ParamDefinition>(params.length);
  for (let i = 0; i < params.length; i++) {
    copy[i] = params[i]!;
  }
  return [copy];
}

export function defineFunction<
  const T extends DefineFunctionOptions,
  F extends (...args: any[]) => any
>(
  name: string,
  fn: ValidateFunctionSignature<F>,
  options?: T
): DefinedFunction<T, F> {
  // The external API types remain exactly the same, but internal function accepts positional parameters only

  /**
   * Function that accepts either positional arguments or a record object.
   * Parameter names are inferred from the params array: name, value, etc.
   * All calls are converted to positional format before calling the internal function.
   */
  const result: DefinedFunction<T, F> = function(...args: any[]): ReturnType<F> {
    const rawParams = options?.params;
    if (!rawParams) {
      return fn(...args);
    }

    // Normalize params - handle overloaded signatures
    const paramSignatures = normalizeParamSignatures(rawParams);

    // For direct calls, use the first signature (overloading handled in callWithContext)
    const params = paramSignatures[0]!;

    // Validate rest parameter position
    validateRestParameterPosition(params);

    // Parse arguments into a record
    const record = parseArgumentsToRecord(args, params);

    // Apply defaults and validate
    applyDefaultsAndValidate(record, params);

    // Convert to positional arguments and call internal function
    const positionalArgs = buildPositionalArgs(record, params);
    return fn(...positionalArgs);
  } as DefinedFunction<T, F>;

  /** Attach runtime metadata directly; keep the callable as a real function. */
  Object.defineProperties(result, {
    name: {
      value: name,
      configurable: true
    },
    options: {
      value: options,
      configurable: true
    },
    _internal: {
      value: fn,
      configurable: true
    }
  });

  return result;
}

/** This will be called internally by Jess to functions created with defineFunction */
export async function callWithContext(context: Context, fn: (...args: any[]) => any, ...args: any[]): Promise<any> {
  const runtimeFn: RuntimeFunction = fn;
  const listArg = args.length === 1 && isNode(args[0], N.List)
    ? args[0] as List
    : undefined;
  if (listArg) {
    const listValues = listArg.value;
    args = new Array(listValues.length);
    for (let i = 0; i < listValues.length; i++) {
      args[i] = listValues[i];
    }
  }
  // Only reject record-based calls (plain objects) when there's no params metadata
  // Collections are allowed as positional arguments even without params metadata
  // (e.g., detached rulesets passed to mixins)
  if (!runtimeFn.options?.params) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (isPlainObject(arg) && !isNode(arg)) {
        throw new Error('Record-based call without params is not supported');
      }
    }
  }

  const hasParams = !!runtimeFn.options?.params;

  if (!hasParams) {
    // No metadata; treat as normal positional function call (sync or async)
    return runtimeFn.call(context, ...args);
  }

  /** Normalize positional args into a List node for tracking original arguments */
  let originalArgsList: List;
  if (listArg) {
    const copiedListArg = listArg.cloneForPlacement();
    if (!isNode(copiedListArg, N.List)) {
      throw new TypeError('Copied function arguments must remain a List');
    }
    originalArgsList = copiedListArg;
    const placement = getRawArgsPlacement(listArg);
    if (placement) {
      setRawArgsPlacement(originalArgsList, placement);
    }
  } else {
    const copiedArgs = new Array(args.length);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      copiedArgs[i] = isNode(arg) ? arg.cloneForPlacement() : arg;
    }
    originalArgsList = new List(copiedArgs);
  }
  const originalValues = originalArgsList.value;
  args = new Array(originalValues.length);
  for (let i = 0; i < originalValues.length; i++) {
    args[i] = originalValues[i];
  }

  const params = runtimeFn.options?.params;
  const options = runtimeFn.options;

  // Apply preprocessParams if provided (e.g., for splitting sequences)
  if (options?.preprocessParams && options.preprocessParams.length > 0) {
    for (const preprocessor of options.preprocessParams) {
      const processed = preprocessor(args, context);
      if (isThenable(processed)) {
        args = await processed;
      } else {
        args = processed;
      }
    }
  }

  // Handle function overloading: params can be an array of param arrays
  // Normalize to always be an array of signatures
  const paramSignatures = normalizeParamSignatures(params);

  let matchedParams: readonly ParamDefinition[] | undefined;
  let record: any;
  let lastError: Error | undefined;

  // Try each signature until one matches
  for (const signature of paramSignatures) {
    try {
      record = parseCallWithContextArgs(args, signature);
      // Try to build positional args to validate the signature matches
      // We'll do a dry-run validation
      const tempRecord = { ...record };
      let isValid = true;

      // Check if we have a record object (plain object) in args
      // Collections are treated as positional arguments, not record-based calls
      let hasRecordArg = false;
      for (let i = 0; i < args.length; i++) {
        if (isPlainObject(args[i])) {
          hasRecordArg = true;
          break;
        }
      }

      for (let i = 0; i < signature.length; i++) {
        const def = signature[i]!;
        const value = tempRecord[def.name];

        // Check required parameters
        if (!def.optional && !def.rest && value === undefined) {
          isValid = false;
          break;
        }

        // Check if we have enough arguments (skip this check if we have a record arg)
        if (!hasRecordArg && !def.rest && i >= args.length && !def.optional) {
          isValid = false;
          break;
        }
      }

      // Check if we have too many arguments (not counting rest params or record args)
      let hasRest = false;
      for (let i = 0; i < signature.length; i++) {
        if (signature[i]!.rest) {
          hasRest = true;
          break;
        }
      }
      if (!hasRest && !hasRecordArg && args.length > signature.length) {
        isValid = false;
      }

      if (isValid) {
        matchedParams = signature;
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
  }

  // If no signature matched, throw an error
  if (!matchedParams) {
    if (lastError) {
      throw lastError;
    }
    throw new Error(`No matching function signature for ${args.length} argument(s)`);
  }

  // Re-parse with the matched signature to ensure correct record structure
  record = parseCallWithContextArgs(args, matchedParams);

  /**
   * Create FunctionThis proxy for function execution context.
   * The args property is always a function that returns the arguments.
   */
  context.callStack.at(-1)?.adopt(originalArgsList);
  const functionThis: FunctionThis = {
    context,
    args: () => originalArgsList.eval(context),
    rawArgs: originalArgsList,
    caller: context.caller
  };

  // Build positional arguments with evaluation, validation, and conversion
  const positionalArgs = await buildCallWithContextPositionalArgs(record, matchedParams, context);

  // Call the function with the evaluated arguments
  // Mixin functions expect Context as 'this', not FunctionThis
  if (runtimeFn._internal) {
    return runtimeFn._internal.call(functionThis, ...positionalArgs);
  } else {
    // For mixin functions and other functions that expect Context as 'this'
    return runtimeFn.call(context, ...positionalArgs);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates that rest parameters are in the correct position (last)
 */
function validateRestParameterPosition(params: readonly ParamDefinition[]): void {
  const restIndex = params.findIndex(p => p.rest);
  if (restIndex >= 0 && restIndex !== params.length - 1) {
    throw new Error('Rest parameter must be the last parameter');
  }
}

/**
 * Applies conversion plugins to a value
 */
function applyConversionPlugins(value: unknown, plugins: ConversionPlugin[]): unknown {
  let result: unknown = value;

  // Apply conversion plugins in sequence
  for (const plugin of plugins) {
    result = plugin(result);
  }

  return result;
}

/**
 * Parses function arguments into a record object
 */
function parseArgumentsToRecord(args: any[], params: readonly ParamDefinition[]): any {
  const record: any = {};
  let restIndex = -1;
  for (let i = 0; i < params.length; i++) {
    if (params[i]!.rest) {
      restIndex = i;
      break;
    }
  }
  const hasRest = restIndex >= 0;

  // Handle pure record call (single object argument)
  if (args.length === 1 && isPlainObject(args[0])) {
    let isClassInstance = false;
    for (let i = 0; i < params.length; i++) {
      const opt = params[i]!;
      const types = Array.isArray(opt.type) ? opt.type : [opt.type];
      for (let j = 0; j < types.length; j++) {
        const type = types[j];
        if (typeof type === 'function' && args[0] instanceof type) {
          isClassInstance = true;
          break;
        }
      }
      if (isClassInstance) {
        break;
      }
    }

    if (!isClassInstance) {
      const input = args[0] as any;
      const isLateProxy = !!input && typeof input === 'object' && '_raw' in input;
      return isLateProxy ? input._raw : { ...input };
    }
  }

  // Handle hybrid call (positional + record)
  if (args.length > 1 && isPlainObject(args[args.length - 1])) {
    const positionalArgs = new Array(args.length - 1);
    for (let i = 0; i < args.length - 1; i++) {
      positionalArgs[i] = args[i];
    }
    const recordArg = args[args.length - 1];

    // Set values from positional arguments
    if (!hasRest) {
      for (let i = 0; i < positionalArgs.length && i < (params?.length ?? 0); i++) {
        const paramName = params?.[i]?.name;
        if (paramName) {
          record[paramName] = positionalArgs[i];
        }
      }
    } else {
      for (let i = 0; i < (params?.length ?? 0); i++) {
        const def = params[i]!;
        const paramName = def.name;
        if (def.rest) {
          const rest = new Array(positionalArgs.length - i);
          for (let j = i; j < positionalArgs.length; j++) {
            rest[j - i] = positionalArgs[j];
          }
          record[paramName] = rest;
          break;
        } else if (i < positionalArgs.length) {
          record[paramName] = positionalArgs[i];
        }
      }
    }

    // Override with values from record (record takes precedence)
    Object.assign(record, recordArg);
    return record;
  }

  // Handle pure positional call
  if (!hasRest) {
    for (let i = 0; i < Math.max(args.length, params?.length ?? 0); i++) {
      const paramName = params?.[i]?.name;
      if (paramName) {
        if (i < args.length) {
          record[paramName] = args[i];
        } else if (params?.[i]?.default !== undefined) {
          record[paramName] = params![i]?.default;
        } else if (params?.[i]?.optional) {
          record[paramName] = undefined;
        }
      }
    }
  } else {
    for (let i = 0; i < (params?.length ?? 0); i++) {
      const def = params[i]!;
      const paramName = def.name;
      if (def.rest) {
        const rest = new Array(args.length - i);
        for (let j = i; j < args.length; j++) {
          rest[j - i] = args[j];
        }
        record[paramName] = rest;
        break;
      } else if (i < args.length) {
        record[paramName] = args[i];
      } else if (def.default !== undefined) {
        record[paramName] = def.default;
      } else if (def.optional) {
        record[paramName] = undefined;
      }
    }
  }

  return record;
}

/**
 * Applies defaults and validates arguments
 */
function applyDefaultsAndValidate(record: any, params: readonly ParamDefinition[]): void {
  // Apply defaults for missing parameters
  for (const paramDef of params ?? []) {
    const paramName = paramDef.name;
    if (record[paramName] === undefined && paramDef.default !== undefined) {
      record[paramName] = paramDef.default;
    }
    // Normalize rest param to array
    if (paramDef.rest) {
      const current = record[paramName];
      if (current === undefined) {
        record[paramName] = [];
      } else if (!Array.isArray(current)) {
        record[paramName] = [current];
      }
    }
  }

  validateArguments(record, params);
}

/**
 * Builds positional arguments from record
 */
function buildPositionalArgs(record: any, params: readonly ParamDefinition[]): any[] {
  const positionalArgs: any[] = [];

  for (let i = 0; i < (params?.length ?? 0); i++) {
    const def = params![i]!;
    const name = def.name;

    if (def.rest) {
      const v = record[name];
      const arr: any[] = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
      if (def.lazy) {
        for (let j = 0; j < arr.length; j++) {
          positionalArgs.push(createThunk(arr[j], def));
        }
      } else {
        for (let j = 0; j < arr.length; j++) {
          const item = arr[j];
          // Apply conversion plugins if defined
          if (def.convert && item instanceof Dimension) {
            positionalArgs.push(applyConversionPlugins(item, def.convert));
          } else {
            positionalArgs.push(item);
          }
        }
      }
    } else {
      const v = record[name];
      if (def.lazy) {
        // For optional lazy parameters, if value is undefined, pass undefined directly
        // instead of creating a thunk (which would try to call undefined())
        if (v === undefined && (def.optional || def.default !== undefined)) {
          positionalArgs.push(undefined);
        } else {
          positionalArgs.push(createThunk(v, def));
        }
      } else {
        // Apply conversion plugins if defined
        if (def.convert && v instanceof Dimension) {
          positionalArgs.push(applyConversionPlugins(v, def.convert));
        } else {
          positionalArgs.push(v);
        }
      }
    }
  }

  return positionalArgs;
}

/**
 * Parses callWithContext arguments into a record
 */
function parseCallWithContextArgs(args: any[], params: readonly ParamDefinition[] | undefined): any {
  const record: any = {};
  const restIndex = params ? params.findIndex(p => p.rest) : -1;
  const hasRest = (restIndex ?? -1) >= 0;

  if (!hasRest) {
    for (let i = 0; i < Math.min(args.length, params?.length ?? 0); i++) {
      let arg = args[i];
      // Collections are treated as positional arguments, not record-based calls
      if (isPlainObject(arg) && !isNode(arg)) {
        Object.assign(record, arg);
        continue;
      }
      const paramName = params?.[i]?.name;
      if (!paramName) {
        throw new Error('Function does not support this number of arguments');
      }
      record[paramName] = args[i];
    }
  } else {
    for (let i = 0; i < (params?.length ?? 0); i++) {
      const def = params![i]!;
      const paramName = def.name;
      const arg = args[i];
      // Collections are treated as positional arguments, not record-based calls
      if (isPlainObject(arg) && !isNode(arg)) {
        Object.assign(record, arg);
        continue;
      }
      if (def.rest) {
        const rest = new Array(args.length - i);
        for (let j = i; j < args.length; j++) {
          rest[j - i] = args[j];
        }
        record[paramName] = rest;
        break;
      } else {
        record[paramName] = arg;
      }
    }
  }

  return record;
}

/**
 * Builds positional arguments for callWithContext with evaluation
 */
async function buildCallWithContextPositionalArgs(
  record: any,
  params: readonly ParamDefinition[] | undefined,
  context: Context
): Promise<any[]> {
  const positionalArgs: any[] = [];

  for (let i = 0; i < (params?.length ?? 0); i++) {
    const def = params![i]!;
    const name = def.name;

    if (def.rest) {
      const v = record[name];
      const arr: any[] = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
      if (def.lazy) {
        for (let j = 0; j < arr.length; j++) {
          positionalArgs.push(createThunk(arr[j], def, context));
        }
      } else {
        for (const item of arr) {
          let processedItem: any = (isNode(item) && !item.evaluated) ? item.eval(context) : item;
          if (isThenable(processedItem)) {
            processedItem = await processedItem;
          }

          // Validate AFTER evaluation but BEFORE conversion
          validateArgumentIfNeeded(processedItem, def, 'Argument');

          // Apply conversion plugins if defined
          if (def.convert && processedItem instanceof Dimension) {
            processedItem = applyConversionPlugins(processedItem, def.convert);
          }
          positionalArgs.push(processedItem);
        }
      }
    } else {
      const v = record[name];
      if (def.lazy) {
        // For optional lazy parameters, if value is undefined, pass undefined directly
        // instead of creating a thunk (which would try to call undefined())
        if (v === undefined && (def.optional || def.default !== undefined)) {
          positionalArgs.push(undefined);
        } else {
          positionalArgs.push(createThunk(v, def, context));
        }
      } else {
        let processedValue: any = (isNode(v) && !v.evaluated) ? v.eval(context) : v;

        // Handle async evaluation without truncating remaining parameters.
        if (isThenable(processedValue)) {
          processedValue = await processedValue;
        }

        // Validate AFTER evaluation but BEFORE conversion
        validateArgumentIfNeeded(processedValue, def, 'Argument');

        // Apply conversion plugins if defined
        if (def.convert && processedValue instanceof Dimension) {
          processedValue = applyConversionPlugins(processedValue, def.convert);
        }
        positionalArgs.push(processedValue);
      }
    }
  }

  return positionalArgs;
}

/**
 * Creates a thunk function that evaluates a value and validates the result
 */
function createThunk(val: any, paramDef: ParamDefinition, context?: Context): () => MaybePromise<any> {
  // For direct calls without context, val should be the user's lazy function (e.g., () => new Dimension(...))
  // NOT a thunk. We create a thunk that calls val() and validates the resolved result.
  if (typeof val === 'function' && !context) {
    // Create a thunk that calls val() and validates the resolved result
    // Note: We validate the RESOLVED result when the thunk is called, not the function itself
    return async (): Promise<any> => {
      const result = await val();
      // A thunk should never return a function - if it does, that's an error
      // Check both typeof and instanceof Function to catch all function types
      if (typeof result === 'function' || result instanceof Function) {
        throw new Error(`Thunk for parameter '${paramDef?.name}' returned a function. This indicates val was already a thunk, which should never happen. Original val type: ${typeof val}, result type: ${typeof result}, result constructor: ${result?.constructor?.name}`);
      }
      // Validate the RESOLVED result (not the function itself)
      // This is where lazy parameter validation happens - when the thunk is called and the value is resolved
      // Skip validation for optional parameters that are undefined
      if (paramDef && !paramDef.rest && !(result === undefined && (paramDef.optional || paramDef.default !== undefined))) {
        const validation = validateValue(result, paramDef.type, paramDef.name);
        if (!validation.isValid) {
          throw new TypeError(validation.errorMessage);
        }
      }
      return result;
    };
  }

  // For callWithContext path or non-function values
  // If val is undefined and parameter is optional, return a thunk that returns undefined
  if (val === undefined && (paramDef?.optional || paramDef?.default !== undefined)) {
    return async (): Promise<any> => {
      return undefined;
    };
  }
  return async (): Promise<any> => {
    let result;
    if (context && isNode(val) && !val.evaluated) {
      result = await val.eval(context);
    } else if (typeof val === 'function') {
      // If val is a function (lazy parameter), call it
      result = await val();
    } else {
      result = val;
    }

    // Validate the evaluated result if we have param definition
    // Note: For lazy parameters, we validate the result of calling the function, not the function itself
    // Skip validation for optional parameters that are undefined
    if (paramDef && !paramDef.rest && !(result === undefined && (paramDef.optional || paramDef.default !== undefined))) {
      const validation = validateValue(result, paramDef.type, paramDef.name);
      if (!validation.isValid) {
        throw new TypeError(validation.errorMessage);
      }
    }

    return result;
  };
}

/**
 * Runtime validation function to check argument types and required parameters for record-based calls
 */
function validateArguments(record: any, params?: readonly ParamDefinition[]) {
  if (!params) {
    return;
  }

  // Check that all required parameters are provided
  for (const paramDef of params) {
    const paramName = paramDef.name;
    const expectedType = paramDef.type;
    const isOptional = paramDef.optional || paramDef.default !== undefined;
    const value = record[paramName];

    // Check if required parameter is missing
    if (!isOptional && value === undefined) {
      throw new TypeError(`Required argument '${paramName}' is missing`);
    }

    // Skip validation for undefined optional arguments
    if (value === undefined) {
      continue;
    }

    // For lazy parameters, validate that it's a function (validation of result happens in thunk)
    if (paramDef.lazy) {
      if (typeof value !== 'function') {
        throw new TypeError(`Argument '${paramName}' must be a function (lazy parameter). Got: ${typeof value}`);
      }
      continue;
    }

    const isRest = paramDef.rest === true;
    if (isRest) {
      if (!Array.isArray(value)) {
        throw new TypeError(`Argument '${paramName}' must be an array (rest parameter)`);
      }
      const elementTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
      for (let idx = 0; idx < value.length; idx++) {
        const el = value[idx];
        let isValid = false;
        for (let i = 0; i < elementTypes.length; i++) {
          if (isValidType(el, elementTypes[i]!)) {
            isValid = true;
            break;
          }
        }
        if (!isValid) {
          let typeList = '';
          for (let i = 0; i < elementTypes.length; i++) {
            if (i > 0) {
              typeList += ', ';
            }
            const t = elementTypes[i] as any;
            typeList += typeof t === 'function' ? t.name : t;
          }
          const actualType = typeof el === 'object' && el !== null ? el.constructor?.name || typeof el : typeof el;
          throw new TypeError(`Element ${idx} of '${paramName}' must be of type '${typeList}'. Got: ${actualType}`);
        }
      }
    } else {
      const validation = validateValue(value, expectedType, paramName, 'Argument');
      if (!validation.isValid) {
        throw new TypeError(validation.errorMessage);
      }
    }
  }
}

/**
 * Centralized validation result
 */
interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Validate argument if needed (checks for lazy and undefined values)
 */
function validateArgumentIfNeeded(
  value: any,
  def: any,
  prefix: string = 'Parameter'
): void {
  if (!def.lazy && value !== undefined) {
    const validation = validateValue(value, def.type, def.name, prefix);
    if (!validation.isValid) {
      throw new TypeError(validation.errorMessage);
    }
  }
}

/**
 * Centralized validation function
 */
function validateValue(value: any, expectedType: ArgType | readonly ArgType[], paramName: string, context: string = 'Argument'): ValidationResult {
  // Handle array of types (union types)
  if (Array.isArray(expectedType)) {
    let isValid = false;
    for (let i = 0; i < expectedType.length; i++) {
      if (isValidType(value, expectedType[i]!)) {
        isValid = true;
        break;
      }
    }
    if (!isValid) {
      let typeList = '';
      for (let i = 0; i < expectedType.length; i++) {
        if (i > 0) {
          typeList += ', ';
        }
        const t = expectedType[i] as any;
        typeList += typeof t === 'function' ? t.name : t;
      }
      const actualType = typeof value === 'object' && value !== null ? value.constructor?.name || typeof value : typeof value;
      return {
        isValid: false,
        errorMessage: `${context} '${paramName}' must be one of: ${typeList}. Got: ${actualType}`
      };
    }
    return { isValid: true };
  }

  // Handle single type
  if (!isValidType(value, expectedType)) {
    const typeName = typeof expectedType === 'function' ? expectedType.name : expectedType;
    const actualType = typeof value === 'object' && value !== null ? value.constructor?.name || typeof value : typeof value;
    return {
      isValid: false,
      errorMessage: `${context} '${paramName}' must be of type '${typeName}'. Got: ${actualType}`
    };
  }

  return { isValid: true };
}

/**
 * Check if a value matches the expected type
 */
function isValidType(value: any, expectedType: ArgType): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'undefined':
      return value === undefined;
    default:
      // Check if it's a class constructor
      if (typeof expectedType === 'function') {
        return value instanceof expectedType;
      }
      return false;
  }
}
