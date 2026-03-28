import { isPlainObject } from './tree/util/collections.js';
import { AbstractClass, Class, OmitIndexSignature } from 'type-fest';
import { isNode } from './tree/util/is-node.js';
import { N } from './tree/node-type.js';
import type { Context } from './context.js';
import { isThenable } from '@jesscss/awaitable-pipe';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { List, Sequence, Operation, Num, Dimension } from './tree/index.js';
import type { ConversionPlugin, PreprocessParams } from './conversions.js';
import { isEvaluated } from './tree/util/field-helpers.js';
export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
export type ArgType = PrimitiveType | Class<any> | AbstractClass<any>;
export type Lazy<T> = () => MaybePromise<T>;

/**
 * FunctionThis provides a proxy-based interface for function execution context.
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
type ValidateFunctionSignature<
  T extends DefineFunctionOptions,
  F extends (...args: any[]) => any
> = F;

export function defineFunction<
  const T extends DefineFunctionOptions,
  F extends (...args: any[]) => any
>(
  name: string,
  fn: ValidateFunctionSignature<T, F>,
  options?: T
) {
  // The external API types remain exactly the same, but internal function accepts positional parameters only

  type NamedFunction = {
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
  ) & {
    /** @todo - This inference is not working correctly - fix later */
    call(thisArg: any, ...args: Parameters<NamedFunction>): ReturnType<F>;
    apply(thisArg: any, args: Parameters<NamedFunction>): ReturnType<F>;
  };

  /**
   * Function that accepts either positional arguments or a record object.
   * Parameter names are inferred from the params array: name, value, etc.
   * All calls are converted to positional format before calling the internal function.
   */
  const result = function(...args: any[]): ReturnType<F> {
    const rawParams = options?.params;
    if (!rawParams) {
      return (fn as any)(...args);
    }

    // Normalize params - handle overloaded signatures
    const paramSignatures: ParamDefinition[][] = Array.isArray(rawParams) && rawParams.length > 0 && Array.isArray(rawParams[0])
      ? rawParams.map(sig => [...sig]) as ParamDefinition[][]
      : [[...(rawParams as readonly ParamDefinition[])]];

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
    return (fn as any)(...positionalArgs);
  } as NamedFunction;

  /** Allow runtime reflection on the function */
  return new Proxy(result, {
    has(target, prop) {
      if (prop === 'name' || prop === 'options') {
        return true;
      }
      return prop in target;
    },
    get(target, prop) {
      if (prop === 'name') {
        return name;
      } else if (prop === 'options') {
        return options;
      } else if (prop === '_internal') {
        return fn;
      }
      return (target as any)[prop];
    }
  });
}

/** This will be called internally by Jess to functions created with defineFunction */
export async function callWithContext(context: Context, fn: (...args: any[]) => any, ...args: any[]): Promise<any> {
  const listArg = args.length === 1 && isNode(args[0], N.List)
    ? args[0] as List
    : undefined;
  args = listArg ? [...listArg.get('value')] : args;
  // Only reject record-based calls (plain objects) when there's no params metadata
  // Collections are allowed as positional arguments even without params metadata
  // (e.g., detached rulesets passed to mixins)
  if (!(fn as any)?.options?.params && args.some(arg => isPlainObject(arg) && !isNode(arg))) {
    throw new Error('Record-based call without params is not supported');
  }

  /** Normalize positional args into a List node for tracking original arguments */
  const originalArgsList: List = listArg
    ? listArg.clone(false)
    : new List(args.map(arg => isNode(arg) ? arg.clone() : arg));

  const hasParams = !!(fn as any)?.options?.params;

  if (!hasParams) {
    // No metadata; treat as normal positional function call (sync or async)
    return (fn as any).call(context, ...args);
  }

  const params = (fn as any)?.options?.params as DefineFunctionOptions['params'] | undefined;
  const options = (fn as any)?.options as DefineFunctionOptions | undefined;

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
  const paramSignatures: ParamDefinition[][] = (() => {
    if (!params) {
      return [];
    }
    // Check if params is an array of arrays (overloaded signatures)
    if (Array.isArray(params) && params.length > 0 && Array.isArray(params[0])) {
      return params.map(sig => [...sig]) as ParamDefinition[][];
    }
    // Single signature - wrap in array
    return [[...(params as readonly ParamDefinition[])]];
  })();

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
      const hasRecordArg = args.some(arg => isPlainObject(arg));

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
      const hasRest = signature.some(p => p.rest);
      if (!hasRest && !hasRecordArg && args.length > signature.length) {
        isValid = false;
      }

      if (isValid) {
        matchedParams = signature;
        break;
      }
    } catch (error) {
      lastError = error as Error;
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
  if ((fn as any)._internal) {
    return ((fn as any)._internal).call(functionThis, ...positionalArgs);
  } else {
    // For mixin functions and other functions that expect Context as 'this'
    return (fn as any).call(context, ...positionalArgs);
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
  const restIndex = params.findIndex(p => (p as any).rest);
  const hasRest = restIndex >= 0;

  // Handle pure record call (single object argument)
  if (args.length === 1 && isPlainObject(args[0])) {
    const isClassInstance = params?.some((opt) => {
      const types = Array.isArray(opt.type) ? opt.type : [opt.type];
      return types.some(type =>
        typeof type === 'function' && args[0] instanceof type
      );
    });

    if (!isClassInstance) {
      const input = args[0] as any;
      const isLateProxy = !!input && typeof input === 'object' && '_raw' in input;
      return isLateProxy ? input._raw : { ...input };
    }
  }

  // Handle hybrid call (positional + record)
  if (args.length > 1 && isPlainObject(args[args.length - 1])) {
    const positionalArgs = args.slice(0, -1);
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
        if ((def as any).rest) {
          record[paramName] = positionalArgs.slice(i);
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
      if ((def as any).rest) {
        record[paramName] = args.slice(i);
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
    if ((paramDef as any).rest) {
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

    if ((def as any).rest) {
      const v = record[name];
      const arr: any[] = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
      if ((def as any).lazy) {
        positionalArgs.push(...arr.map(item => createThunk(item, def)));
      } else {
        positionalArgs.push(...arr.map((item) => {
          // Apply conversion plugins if defined
          if (def.convert && item instanceof Dimension) {
            return applyConversionPlugins(item, def.convert);
          }
          return item;
        }));
      }
    } else {
      const v = record[name];
      if ((def as any).lazy) {
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
  const restIndex = params ? params.findIndex(p => (p as any).rest) : -1;
  const hasRest = (restIndex ?? -1) >= 0;

  if (!hasRest) {
    for (let i = 0; i < Math.min(args.length, params?.length ?? 0); i++) {
      let arg = args[i];
      // Collections are treated as positional arguments, not record-based calls
      if (isPlainObject(arg) && !isNode(arg)) {
        Object.assign(record, arg);
        continue;
      }
      const paramName = params?.[i]?.name as string;
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
      if ((def as any).rest) {
        record[paramName] = args.slice(i);
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

    if ((def as any).rest) {
      const v = record[name];
      const arr: any[] = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
      if ((def as any).lazy) {
        positionalArgs.push(...arr.map(item => createThunk(item, def, context)));
      } else {
        for (const item of arr) {
          let processedItem: any = (isNode(item) && !isEvaluated(item, context)) ? (item as any).eval(context) : item;
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
      if ((def as any).lazy) {
        // For optional lazy parameters, if value is undefined, pass undefined directly
        // instead of creating a thunk (which would try to call undefined())
        if (v === undefined && (def.optional || def.default !== undefined)) {
          positionalArgs.push(undefined);
        } else {
          positionalArgs.push(createThunk(v, def, context));
        }
      } else {
        let processedValue: any = (isNode(v) && !isEvaluated(v, context)) ? (v as any).eval(context) : v;

        // Handle async evaluation without truncating remaining parameters.
        if (isThenable(processedValue)) {
          processedValue = await processedValue;
        }

        // Validate AFTER evaluation but BEFORE conversion
        validateArgumentIfNeeded(processedValue, def, 'Argument');

        const callerName = context.caller && isNode(context.caller, N.Call)
          ? (() => {
              const n = context.caller!.get('name');
              return typeof n === 'string'
                ? n
                : (isNode(n, N.Reference) ? String(n.key?.valueOf?.() ?? '') : '');
            })()
          : '';
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
 * Validates callWithContext arguments from record (before conversion)
 */
function validateCallWithContextArgs(record: any, params: readonly ParamDefinition[] | undefined): void {
  if (!params) {
    return;
  }

  for (let i = 0; i < params.length; i++) {
    const def = params[i]!;
    const value = record[def.name];

    // Skip validation for lazy parameters since they're passed as thunks
    if ((def as any).lazy) {
      continue;
    }

    // Skip validation for rest parameters as they're validated as arrays
    if ((def as any).rest) {
      continue;
    }

    // Skip validation for optional parameters that are undefined
    if ((def as any).optional && value === undefined) {
      continue;
    }

    validateArgument(value, def, 'Argument');
  }
}

/**
 * Creates a thunk function that evaluates a value and validates the result
 */
function createThunk(val: any, paramDef: any, context?: Context): () => MaybePromise<any> {
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
      if (paramDef && !(paramDef as any).rest && !(result === undefined && (paramDef.optional || paramDef.default !== undefined))) {
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
    if (context && isNode(val) && !isEvaluated(val, context)) {
      result = await (val as any).eval(context);
    } else if (typeof val === 'function') {
      // If val is a function (lazy parameter), call it
      result = await val();
    } else {
      result = val;
    }

    // Validate the evaluated result if we have param definition
    // Note: For lazy parameters, we validate the result of calling the function, not the function itself
    // Skip validation for optional parameters that are undefined
    if (paramDef && !(paramDef as any).rest && !(result === undefined && (paramDef.optional || paramDef.default !== undefined))) {
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
    if ((paramDef as any).lazy) {
      if (typeof value !== 'function') {
        throw new TypeError(`Argument '${paramName}' must be a function (lazy parameter). Got: ${typeof value}`);
      }
      continue;
    }

    const isRest = (paramDef as any).rest === true;
    if (isRest) {
      if (!Array.isArray(value)) {
        throw new TypeError(`Argument '${paramName}' must be an array (rest parameter)`);
      }
      const elementTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
      for (let idx = 0; idx < (value as any[]).length; idx++) {
        const el = (value as any[])[idx];
        const isValid = (Array.isArray(elementTypes) ? elementTypes : [elementTypes]).some(type => isValidType(el, type));
        if (!isValid) {
          const types = Array.isArray(elementTypes) ? elementTypes : [elementTypes];
          const typeList = types.map((t: any) => typeof t === 'function' ? t.name : t).join(', ');
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
  if (!(def as any).lazy && value !== undefined) {
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
    const isValid = expectedType.some(type => isValidType(value, type));
    if (!isValid) {
      const typeList = expectedType.map((t: any) => typeof t === 'function' ? t.name : t).join(', ');
      const actualType = typeof value === 'object' && value !== null ? value.constructor?.name || typeof value : typeof value;
      return {
        isValid: false,
        errorMessage: `${context} '${paramName}' must be one of: ${typeList}. Got: ${actualType}`
      };
    }
    return { isValid: true };
  }

  // Handle single type
  if (!isValidType(value, expectedType as ArgType)) {
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
 * Validate array elements (for rest parameters)
 */
function validateArrayElements(value: any[], elementTypes: ArgType | readonly ArgType[], paramName: string, context: string = 'Argument'): ValidationResult {
  const types = Array.isArray(elementTypes) ? elementTypes : [elementTypes];

  for (let idx = 0; idx < value.length; idx++) {
    const el = value[idx];
    const isValid = types.some(type => isValidType(el, type));
    if (!isValid) {
      const typeList = types.map((t: any) => typeof t === 'function' ? t.name : t).join(', ');
      const actualType = typeof el === 'object' && el !== null ? el.constructor?.name || typeof el : typeof el;
      return {
        isValid: false,
        errorMessage: `Element ${idx} of '${paramName}' must be of type '${typeList}'. Got: ${actualType}`
      };
    }
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

/**
 * Validates a single argument against its parameter definition
 */
function validateArgument(value: any, def: any, context: string = 'argument'): void {
  // Skip validation for optional parameters that are undefined
  if ((def as any).optional && value === undefined) {
    return;
  }

  // For lazy parameters, validate that it's a function
  if ((def as any).lazy) {
    if (typeof value !== 'function') {
      throw new TypeError(
        `${context} '${def.name}' must be a function (lazy parameter). Got: ${typeof value}`
      );
    }
    return;
  }

  // Validate rest parameters as arrays
  if ((def as any).rest) {
    if (!Array.isArray(value)) {
      throw new TypeError(`${context} '${def.name}' must be an array (rest parameter)`);
    }
    const expectedType = def.type;
    for (let idx = 0; idx < value.length; idx++) {
      const el = value[idx];
      if (!isValidType(el, expectedType as ArgType)) {
        const typeName = typeof expectedType === 'function' ? expectedType.name : expectedType;
        const actualType = typeof el === 'object' && el !== null ? el.constructor?.name || typeof el : typeof el;
        throw new TypeError(`Element ${idx} of '${def.name}' must be of type '${typeName}'. Got: ${actualType}`);
      }
    }
    return;
  }

  // Validate regular parameters
  const expectedType = def.type;
  const validation = validateValue(value, expectedType, def.name, context);
  if (!validation.isValid) {
    throw new TypeError(validation.errorMessage);
  }
}