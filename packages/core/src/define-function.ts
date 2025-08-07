import { Class, OmitIndexSignature } from 'type-fest';

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
              ? T
              : never;

// Get positional types for up to 5 parameters with strong typing
// type GetPositionalTypes<T extends DefineFunctionOptions> = {
//   [K in keyof T['params']]: T['params'][K] extends { optional: true } | { default: any }
//     ? GetArgType<T['params'][K] extends { type: ArgType } ? T['params'][K]['type'] : T['params'][K] extends { type: readonly ArgType[] } ? T['params'][K]['type'][number] : never> | undefined
//     : T['params'][K] extends { name: infer N extends string; type: ArgType }
//       ? GetArgType<T['params'][K]['type']>
//       : T['params'][K] extends { name: infer N extends string; type: readonly ArgType[] }
//         ? GetArgType<T['params'][K]['type'][number]>
//         : never;
// } extends infer U
//   ? U extends readonly any[]
//     ? U
//     : never
//   : never;

// Helper to make optional parameters optional in function signature
type MakeOptional<T extends readonly any[]> = T extends [...infer Required, infer Optional]
  ? Optional extends undefined
    ? [...Required, Optional?]
    : [...Required, Optional]
  : T;

// Get record types for named parameters
type GetRecordType<T extends DefineFunctionOptions> = OmitIndexSignature<{
  [K in keyof T['params'] as K extends `${number}`
    ? T['params'][K] extends { name: infer N extends string }
      ? N
      : never
    : never]:
  T['params'][K] extends { optional: true } | { default: any }
    // eslint-disable-next-line @stylistic/indent-binary-ops
    ? GetArgType<
      T['params'][K] extends { type: infer A extends ArgType }
        ? A
        : T['params'][K] extends { type: readonly ArgType[] }
          ? T['params'][K]['type'][number]
          : never
      > | undefined
    : T['params'][K] extends { type: infer A extends ArgType }
      ? GetArgType<A>
      : T['params'][K] extends { type: readonly ArgType[] }
        ? GetArgType<T['params'][K]['type'][number]>
        : never;
}>;

/** Hack to increment a number while building a type */
type BuildTuple<L extends number, T extends unknown[] = []> =
  T['length'] extends L ? T : BuildTuple<L, [...T, unknown]>;
type Increment<N extends number> = [...BuildTuple<N>, unknown]['length'] extends number ? [...BuildTuple<N>, unknown]['length'] : never;

// type GetPositionalTypes<
//   T extends DefineFunctionOptions,
//   N extends number = 0,
//   OmitKeys extends string = ''
// > = (N extends keyof T['params']
//   // eslint-disable-next-line @stylistic/indent-binary-ops
//   ? {
//     [K in N]: T['params'][K] extends { optional: true } | { default: any }
//       ? T['params'][K] extends {
//         name: infer Name extends string;
//         type: infer A extends ArgType;
//       }
//         ? GetArgType<A> | Omit<GetRecordType<T>, Name | OmitKeys>
//         : T['params'][K] extends {
//           name: infer Name extends string;
//           type: readonly ArgType[];
//         }
//           ? GetArgType<T['params'][K]['type'][number]> | Omit<GetRecordType<T>, Name | OmitKeys>
//           : never
//             | undefined
//       : T['params'][K] extends {
//         name: infer Name extends string;
//         type: infer A extends ArgType;
//       }
//         ? GetArgType<A> | Omit<GetRecordType<T>, Name | OmitKeys>
//         : T['params'][K] extends {
//           name: infer Name extends string;
//           type: readonly ArgType[];
//         }
//           ? GetArgType<T['params'][K]['type'][number]> | Omit<GetRecordType<T>, Name | OmitKeys>
//           : never;
//   } & (
//       T['params'][N] extends { name: infer Name extends string }
//         ? GetPositionalTypes<T, Increment<N>, OmitKeys | Name>
//         : {}
//     )
//   : {}
// );

type GetPositionalTypes<
  T extends DefineFunctionOptions,
  N extends number = 0,
  OmitKeys extends string = '',
  Acc extends unknown[] = []
> = N extends keyof T['params']
  ? T['params'][N] extends { name: infer Name extends string }
    ? GetPositionalTypes<
        T,
        Increment<N>,
        OmitKeys | Name,
        [...Acc, T['params'][N] extends { optional: true } | { default: any }
          ? T['params'][N] extends { type: infer A extends ArgType }
            ? GetArgType<A> | Omit<GetRecordType<T>, OmitKeys> | undefined
            : T['params'][N] extends { type: readonly ArgType[] }
              ? GetArgType<T['params'][N]['type'][number]> | Omit<GetRecordType<T>, OmitKeys> | undefined
              : never
          : T['params'][N] extends { type: infer A extends ArgType }
            ? GetArgType<A> | Omit<GetRecordType<T>, OmitKeys>
            : T['params'][N] extends { type: readonly ArgType[] }
              ? GetArgType<T['params'][N]['type'][number]> | Omit<GetRecordType<T>, OmitKeys>
              : never
        ]
      >
    : Acc
  : Acc;

/** Mostly a copy of GetRecordTypes, except we don't cast the number index to the name */
// type GetPositionalTypes<T extends DefineFunctionOptions> = OmitIndexSignature<{
//   [K in keyof T['params']]:
//   T['params'][K] extends { optional: true } | { default: any }
//     // eslint-disable-next-line @stylistic/indent-binary-ops
//     ? GetArgType<
//       T['params'][K] extends { type: infer A extends ArgType }
//         ? A
//         : T['params'][K] extends { type: readonly ArgType[] }
//           ? T['params'][K]['type'][number]
//           : never
//       > | undefined
//     : T['params'][K] extends { type: infer A extends ArgType }
//       ? GetArgType<A>
//       : T['params'][K] extends { type: readonly ArgType[] }
//         ? GetArgType<T['params'][K]['type'][number]>
//         : never;
// }> extends infer U
//   ? U extends readonly any[]
//     ? U
//     : never
//   : never;

const foo = {
  params: [
    { name: 'name', type: 'string' },
    { name: 'age', type: 'number' },
    { name: 'high', type: ['boolean', 'number'], optional: true }
  ]
} as const;

type T = GetPositionalTypes<typeof foo>;

export function defineFunction<
  const T extends DefineFunctionOptions,
  F extends (record: any) => any>(
  name: string,
  fn: F,
  options?: T
) {
  // The external API types remain exactly the same, but internal function must accept record

  type NamedFunction = {
    (...args: GetPositionalTypes<T>): ReturnType<F>;
    (values: GetRecordType<T>): ReturnType<F>;
  } & (
    // Strong typing for up to 5 parameters
    T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
      ? {
          (): ReturnType<F>;
          (arg1: GetPositionalTypes<T>[0]): ReturnType<F>;
        }
      : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional: true }, { name: string; type: ArgType | ArgType[]; optional: true }]
        ? {
            (): ReturnType<F>;
            (arg1: GetPositionalTypes<T>[0]): ReturnType<F>;
            (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1]): ReturnType<F>;
          }
        : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
          ? {
              (): ReturnType<F>;
              (arg1: GetPositionalTypes<T>[0]): ReturnType<F>;
              (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1]): ReturnType<F>;
              (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1], arg3: GetPositionalTypes<T>[2]): ReturnType<F>;
            }
          : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
            ? {
                (): ReturnType<F>;
                (arg1: GetPositionalTypes<T>[0]): ReturnType<F>;
                (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1]): ReturnType<F>;
                (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1], arg3: GetPositionalTypes<T>[2]): ReturnType<F>;
                (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1], arg3: GetPositionalTypes<T>[2], arg4: GetPositionalTypes<T>[3]): ReturnType<F>;
              }
            : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
              ? {
                  (): ReturnType<F>;
                  (arg1: GetPositionalTypes<T>[0]): ReturnType<F>;
                  (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1]): ReturnType<F>;
                  (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1], arg3: GetPositionalTypes<T>[2]): ReturnType<F>;
                  (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1], arg3: GetPositionalTypes<T>[2], arg4: GetPositionalTypes<T>[3]): ReturnType<F>;
                  (arg1: GetPositionalTypes<T>[0], arg2: GetPositionalTypes<T>[1], arg3: GetPositionalTypes<T>[2], arg4: GetPositionalTypes<T>[3], arg5: GetPositionalTypes<T>[4]): ReturnType<F>;
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

        validateArguments(record, options?.params);
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
function validateArguments(record: any, params?: readonly { name: string; type: ArgType | ArgType[]; optional?: boolean; default?: any }[]) {
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
      if (!isValidType(value, expectedType)) {
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