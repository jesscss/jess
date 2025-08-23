import isPlainObject from 'lodash-es/isPlainObject';
import { AbstractClass, Class, OmitIndexSignature } from 'type-fest';
import { isNode } from './tree/util/is-node';
import type { Context } from './context';
import { isThenable } from '@jesscss/awaitable-pipe';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
export type ArgType = PrimitiveType | Class<any> | AbstractClass<any>;
export type Lazy<T> = () => MaybePromise<T>;
export type DefineFunctionOptions = {
  params: readonly {
    name: string;
    type: ArgType | readonly ArgType[];
    optional?: boolean;
    default?: any;
    /** Marks this parameter as a variadic rest parameter. Must be the last param. */
    rest?: boolean;
    /** If true, provide a thunk (() => Promise<T>) to the internal positional function */
    lazy?: boolean;
  }[];
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

export function defineFunction<
  const T extends DefineFunctionOptions,
  F extends (...args: any[]) => any>(
  name: string,
  fn: F,
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
    const params = options?.params ?? [] as DefineFunctionOptions['params'];
    const restIndex = params.findIndex(p => (p as any).rest);
    const hasRest = restIndex >= 0;
    if (hasRest && restIndex !== params.length - 1) {
      throw new Error('Rest parameter must be the last parameter');
    }
    // Check if this is a pure record call (single object argument that's not a class instance)
    if (args.length === 1 && isPlainObject(args[0])) {
      // Check if it's actually a class instance (like Color, Dimension) - if so, treat as positional
      const isClassInstance = params?.some((opt) => {
        const types = Array.isArray(opt.type) ? opt.type : [opt.type];
        return types.some(type =>
          typeof type === 'function' && args[0] instanceof type
        );
      });

      if (!isClassInstance) {
        // Pure record call - apply defaults and validate
        const input = args[0] as any;
        const isLateProxy = !!input && typeof input === 'object' && '_raw' in input;
        const rawRecord = isLateProxy ? input._raw : { ...input };

        // Apply defaults for missing parameters
        for (const paramDef of params ?? []) {
          const paramName = paramDef.name;
          if (rawRecord[paramName] === undefined && paramDef.default !== undefined) {
            rawRecord[paramName] = paramDef.default;
          }
          // Normalize rest param to array
          if ((paramDef as any).rest) {
            const current = rawRecord[paramName];
            if (current === undefined) {
              rawRecord[paramName] = [];
            } else if (!Array.isArray(current)) {
              rawRecord[paramName] = [current];
            }
          }
        }

        validateArguments(rawRecord, params ?? [] as DefineFunctionOptions['params']);
        const pos: any[] = [];
        for (let i = 0; i < params.length; i++) {
          const def = params[i]!;
          if ((def as any).rest) {
            const v = rawRecord[def.name];
            const arr = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
            pos.push(...arr);
          } else {
            pos.push(rawRecord[def.name]);
          }
        }
        return (fn as any)(...pos);
      }
    }

    // Check if this is a hybrid call (multiple args with last being an object)
    if (args.length > 1 && isPlainObject(args[args.length - 1])) {
      // Hybrid call: positional args + record
      const positionalArgs = args.slice(0, -1);
      const record = args[args.length - 1];

      // Create merged record from positional args and record object
      const mergedRecord: any = {};

      // First, set values from positional arguments
      if (!hasRest) {
        for (let i = 0; i < positionalArgs.length && i < (params?.length ?? 0); i++) {
          const paramName = params?.[i]?.name;
          if (paramName) {
            mergedRecord[paramName] = positionalArgs[i];
          }
        }
      } else {
        for (let i = 0; i < (params?.length ?? 0); i++) {
          const def = params[i]!;
          const paramName = def.name;
          if ((def as any).rest) {
            mergedRecord[paramName] = positionalArgs.slice(i);
            break;
          } else if (i < positionalArgs.length) {
            mergedRecord[paramName] = positionalArgs[i];
          }
        }
      }

      // Then, override with values from record (record takes precedence)
      Object.assign(mergedRecord, record);

      // Apply defaults for missing parameters
      for (const paramDef of params ?? []) {
        const paramName = paramDef.name;
        if (mergedRecord[paramName] === undefined && paramDef.default !== undefined) {
          mergedRecord[paramName] = paramDef.default;
        }
        if ((paramDef as any).rest) {
          const current = mergedRecord[paramName];
          if (current === undefined) {
            mergedRecord[paramName] = [];
          } else if (!Array.isArray(current)) {
            mergedRecord[paramName] = [current];
          }
        }
      }

      validateArguments(mergedRecord, params);
      const pos: any[] = [];
      for (let i = 0; i < params.length; i++) {
        const def = params[i]!;
        if ((def as any).rest) {
          const v = mergedRecord[def.name];
          const arr = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
          pos.push(...arr);
        } else {
          pos.push(mergedRecord[def.name]);
        }
      }
      return (fn as any)(...pos);
    } else {
      // Pure positional call - convert to record
      const recordArgs: any = {};

      // Map positional arguments to record properties
      if (!hasRest) {
        for (let i = 0; i < Math.max(args.length, params?.length ?? 0); i++) {
          const paramName = params?.[i]?.name;
          if (paramName) {
            if (i < args.length) {
              recordArgs[paramName] = args[i];
            } else if (params?.[i]?.default !== undefined) {
              // Apply default for missing positional argument
              recordArgs[paramName] = params![i]?.default;
            } else if (params?.[i]?.optional) {
              // Apply undefined for missing optional argument
              recordArgs[paramName] = undefined;
            }
          }
        }
      } else {
        for (let i = 0; i < (params?.length ?? 0); i++) {
          const def = params[i]!;
          const paramName = def.name;
          if ((def as any).rest) {
            recordArgs[paramName] = args.slice(i);
            break;
          } else if (i < args.length) {
            recordArgs[paramName] = args[i];
          } else if (def.default !== undefined) {
            recordArgs[paramName] = def.default;
          } else if (def.optional) {
            recordArgs[paramName] = undefined;
          }
        }
      }

      validateArguments(recordArgs, params);
      const pos: any[] = [];
      for (let i = 0; i < params.length; i++) {
        const def = params[i]!;
        if ((def as any).rest) {
          const arr = recordArgs[def.name] ?? [];
          pos.push(...arr);
        } else {
          pos.push(recordArgs[def.name]);
        }
      }
      return (fn as any)(...pos);
    }
  } as NamedFunction;

  /** Allow runtime reflection on the function */
  return new Proxy(result, {
    has(target, prop) {
      if (prop === 'params' || prop === 'name') {
        return true;
      }
      return prop in target;
    },
    get(target, prop) {
      if (prop === 'params') {
        return options?.params;
      } else if (prop === 'name') {
        return name;
      } else if (prop === '_internal') {
        return fn;
      }
      return (target as any)[prop];
    }
  });
}

/** This will be called internally by Jess to functions created with defineFunction */
export function callWithContext(context: Context, fn: (...args: any[]) => any, ...args: any[]): MaybePromise<any> {
  let record: any = {};

  if (!(fn as any)?.params && args.some(arg =>
    (isNode(arg) && arg.type === 'Collection')
    || isPlainObject(arg))
  ) {
    throw new Error('Record-based call without params is not supported');
  }

  if (!(fn as any)?.params) {
    // No metadata; treat as normal positional function call (sync or async)
    return (fn as any).call(context, ...args);
  }

  const params = (fn as any)?.params as DefineFunctionOptions['params'] | undefined;
  const restIndex = params ? params.findIndex(p => (p as any).rest) : -1;
  const hasRest = (restIndex ?? -1) >= 0;

  // Map positional/record/collection arguments to record properties
  if (!hasRest) {
    for (let i = 0; i < args.length; i++) {
      let arg = args[i];
      if (isNode(arg, 'Collection')) {
        arg = arg.toObject(false);
        Object.assign(record, arg);
        continue;
      } else if (isPlainObject(arg)) {
        Object.assign(record, arg);
        continue;
      }
      const paramName = (fn as any).params[i]?.name as string;
      if (!paramName) {
        throw new Error('Function does not support this number of arguments');
      }
      record[paramName] = args[i];
    }
  } else {
    // With rest: fill fixed params, then collect rest
    for (let i = 0; i < (params?.length ?? 0); i++) {
      const def = params![i]!;
      const paramName = def.name;
      const arg = args[i];
      if (isNode(arg, 'Collection')) {
        const obj = arg.toObject(false);
        Object.assign(record, obj);
        continue;
      } else if (isPlainObject(arg)) {
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

  /**
   * Create an object in which all properties are only evaluated when accessed
   * This allows patterns like the if() function to work with references to
   * variables that may not exist.
   */
  // No special record proxy path; proceed to positional building with lazy/sync handling

  // Positional internal function: build positional args; values may be MaybePromise
  const makeThunk = (val: any) => (): MaybePromise<any> => {
    if (isNode(val) && !val.evaluated) {
      return (val as any).eval(context);
    }
    return val;
  };

  const positionalArgs: any[] = [];
  for (let i = 0; i < (params?.length ?? 0); i++) {
    const def = params![i]!;
    const name = def.name;
    if ((def as any).rest) {
      const v = record[name];
      const arr: any[] = Array.isArray(v) ? v : (v === undefined ? [] : [v]);
      if ((def as any).lazy) {
        positionalArgs.push(...arr.map(item => makeThunk(item)));
      } else {
        positionalArgs.push(...arr.map(item => (isNode(item) && !item.evaluated) ? (item as any).eval(context) : item));
      }
    } else {
      const v = record[name];
      if ((def as any).lazy) {
        positionalArgs.push(makeThunk(v));
      } else {
        positionalArgs.push((isNode(v) && !v.evaluated) ? (v as any).eval(context) : v);
      }
    }
  }

  // If any positional arg is thenable, await all then call; else call directly
  const hasAsync = positionalArgs.some(a => isThenable(a));
  if (hasAsync) {
    return Promise.all(positionalArgs.map(a => isThenable(a) ? a : Promise.resolve(a))).then((vals) => {
      return ((fn as any)._internal).call(context, ...vals);
    });
  }
  return ((fn as any)._internal).call(context, ...positionalArgs);
}

/**
 * Runtime validation function to check argument types and required parameters for record-based calls
 */
function validateArguments(record: any, params?: DefineFunctionOptions['params']) {
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

    // Skip validation for lazy parameters since they're passed as thunks
    if ((paramDef as any).lazy) {
      continue;
    }

    const isRest = (paramDef as any).rest === true;
    if (isRest) {
      if (!Array.isArray(value)) {
        throw new TypeError(`Argument '${paramName}' must be an array (rest parameter)`);
      }
      const elementTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
      for (const [idx, el] of (value as any[]).entries()) {
        const isValid = elementTypes.some(type => isValidType(el, type));
        if (!isValid) {
          const typeList = elementTypes.map(t => typeof t === 'function' ? t.name : t).join(', ');
          throw new TypeError(`Element ${idx} of '${paramName}' must be one of: ${typeList}. Got: ${typeof el}`);
        }
      }
    } else {
      if (Array.isArray(expectedType)) {
        // Check if value matches any of the allowed types
        const isValid = expectedType.some(type => isValidType(value, type));
        if (!isValid) {
          throw new TypeError(
            `Argument '${paramName}' must be one of: ${expectedType.join(', ')}. Got: ${typeof value}`
          );
        }
      } else {
        // Single type validation
        if (!isValidType(value, expectedType as ArgType)) {
          const typeName = typeof expectedType === 'function' ? expectedType.name : expectedType;
          throw new TypeError(
            `Argument '${paramName}' must be of type '${typeName}'. Got: ${typeof value}`
          );
        }
      }
    }
  }
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