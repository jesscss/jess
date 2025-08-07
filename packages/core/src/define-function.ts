import { Class, OmitIndexSignature } from 'type-fest';
import { Color } from './tree/color';

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
export type ArgType = PrimitiveType | Class<any>;

export type DefineFunctionOptions = {
  params: readonly {
    name: string;
    type: ArgType | readonly ArgType[];
    optional?: boolean;
    default?: any;
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
            : T extends Class<any>
              ? InstanceType<T>
              : never;

/** This should be getting only required types but it doesn't? */
type GetBaseRecordType<T extends DefineFunctionOptions['params']> = (
  OmitIndexSignature<{
    [K in keyof T as T[K] extends { optional: true } | { default: any }
      ? never
      : T[K] extends { name: infer N extends string }
        ? N
        : never]:
    T[K] extends { type: infer A extends ArgType }
      ? GetArgType<A>
      : T[K] extends { type: readonly ArgType[] }
        ? GetArgType<T[K]['type'][number]>
        : never;
  }>
);

type GetOptionalRecordType<T extends DefineFunctionOptions['params']> = {
  [K in keyof T as T[K] extends { optional: true } | { default: any }
    ? T[K] extends { name: infer N extends string }
      ? N
      : never
    : never]?:
  T[K] extends { type: infer A extends ArgType }
    ? GetArgType<A>
    : T[K] extends { type: readonly ArgType[] }
      ? GetArgType<T[K]['type'][number]>
      : never;
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
      ? First extends { type: infer A extends ArgType }
        ? [(GetArgType<A> | (P & GetRecordType<T>))?, ...GetPositionalTypes<Rest, P>]
        : First extends { type: readonly ArgType[] }
          ? [(GetArgType<First['type'][number]> | (P & GetRecordType<T>))?, ...GetPositionalTypes<Rest, P>]
          : never
      : First extends { type: infer A extends ArgType }
        ? [GetArgType<A> | (P & GetRecordType<T>), ...GetPositionalTypes<Rest, P>]
        : First extends { type: readonly ArgType[] }
          ? [GetArgType<First['type'][number]> | (P & GetRecordType<T>), ...GetPositionalTypes<Rest, P>]
          : never
    : []
  : [];

export function defineFunction<
  const T extends DefineFunctionOptions,
  F extends (record: any) => any>(
  name: string,
  fn: F,
  options?: T
) {
  // The external API types remain exactly the same, but internal function must accept record

  type NamedFunction = {
    (...args: GetPositionalTypes<T['params']>): ReturnType<F>;
    (record: GetRecordType<T['params']>): ReturnType<F>;
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
   * Function that accepts either positional arguments or a record object.
   * Parameter names are inferred from the params array: name, value, etc.
   * All calls are converted to record format before calling the internal function.
   */
  const result = function(...args: any[]): ReturnType<F> {
    // Check if this is a pure record call (single object argument that's not a class instance)
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
      // Check if it's actually a class instance (like Color, Dimension) - if so, treat as positional
      const isClassInstance = options?.params?.some(opt =>
        typeof opt.type === 'function' && args[0] instanceof opt.type
      );

      if (!isClassInstance) {
        // Pure record call - apply defaults and validate
        const record = { ...args[0] }; // Make a copy to avoid mutating the original

        // Apply defaults for missing parameters
        for (const paramDef of options?.params ?? []) {
          const paramName = paramDef.name;
          if (record[paramName] === undefined && paramDef.default !== undefined) {
            record[paramName] = paramDef.default;
          }
        }

        validateArguments(record, options?.params ?? [] as DefineFunctionOptions['params']);
        return fn(record);
      }
    }

    // Check if this is a hybrid call (multiple args with last being an object)
    if (args.length > 1 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1])) {
      // Hybrid call: positional args + record
      const positionalArgs = args.slice(0, -1);
      const record = args[args.length - 1];

      // Create merged record from positional args and record object
      const mergedRecord: any = {};

      // First, set values from positional arguments
      for (let i = 0; i < positionalArgs.length && i < (options?.params?.length ?? 0); i++) {
        const paramName = options?.params?.[i]?.name;
        if (paramName) {
          mergedRecord[paramName] = positionalArgs[i];
        }
      }

      // Then, override with values from record (record takes precedence)
      Object.assign(mergedRecord, record);

      // Apply defaults for missing parameters
      for (const paramDef of options?.params ?? []) {
        const paramName = paramDef.name;
        if (mergedRecord[paramName] === undefined && paramDef.default !== undefined) {
          mergedRecord[paramName] = paramDef.default;
        }
      }

      validateArguments(mergedRecord, options?.params);
      return fn(mergedRecord);
    } else {
      // Pure positional call - convert to record
      const recordArgs: any = {};

      // Map positional arguments to record properties
      for (let i = 0; i < Math.max(args.length, options?.params?.length ?? 0); i++) {
        const paramName = options?.params?.[i]?.name;
        if (paramName) {
          if (i < args.length) {
            recordArgs[paramName] = args[i];
          } else if (options?.params?.[i]?.default !== undefined) {
            // Apply default for missing positional argument
            recordArgs[paramName] = options!.params![i]?.default;
          }
        }
      }

      validateArguments(recordArgs, options?.params);
      return fn(recordArgs);
    }
  } as NamedFunction;

  return result;
}

/**
 * Runtime validation function to check argument types and required parameters for record-based calls
 */
function validateArguments(record: any, params?: DefineFunctionOptions['params']) {
  if (!params) return;

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
    if (value === undefined) continue;

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