import { Class, OmitIndexSignature } from 'type-fest';

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
export type ArgType = PrimitiveType | Class<any>;

export type DefineFunctionOptions = {
  params: readonly {
    name: string;
    type: ArgType | ArgType[];
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
type GetPositionalTypes<T extends DefineFunctionOptions> = {
  [K in keyof T['params']]: T['params'][K] extends { optional: true } | { default: any }
    ? GetArgType<T['params'][K] extends { type: ArgType } ? T['params'][K]['type'] : T['params'][K] extends { type: readonly ArgType[] } ? T['params'][K]['type'][number] : never> | undefined
    : T['params'][K] extends { name: infer N extends string; type: ArgType }
      ? GetArgType<T['params'][K]['type']>
      : T['params'][K] extends { name: infer N extends string; type: readonly ArgType[] }
        ? GetArgType<T['params'][K]['type'][number]>
        : never;
};

// Helper to make optional parameters optional in function signature
type MakeOptional<T extends readonly any[]> = T extends [...infer Required, infer Optional]
  ? Optional extends undefined
    ? [...Required, Optional?]
    : [...Required, Optional]
  : T;

// Get record types for named parameters
type GetRecordTypes<T extends DefineFunctionOptions> = OmitIndexSignature<{
  [K in keyof T['params'] as T['params'][K] extends { name: infer N extends string } ? N : never]?:
  T['params'][K] extends { optional: true } | { default: any }
    ? GetArgType<T['params'][K] extends { type: ArgType } ? T['params'][K]['type'] : T['params'][K] extends { type: readonly ArgType[] } ? T['params'][K]['type'][number] : never> | undefined
    : T['params'][K] extends { type: ArgType }
      ? GetArgType<T['params'][K]['type']>
      : T['params'][K] extends { type: readonly ArgType[] }
        ? GetArgType<T['params'][K]['type'][number]>
        : never;
}>;

export function defineFunction<T extends DefineFunctionOptions, F extends (...args: any[]) => any>(
  name: string,
  fn: F,
  options?: T
) {
  // Type validation to ensure params match function signature
  type ValidateArgs<T extends DefineFunctionOptions, F extends (...args: any[]) => any> =
    Parameters<F> extends GetPositionalTypes<T> ? true : false;
  type ValidateArgsType = ValidateArgs<T, F>;
  const validateArgsType: ValidateArgsType = true as any;

  // Create function signature with strong typing for up to 5 parameters
  type NamedFunction = {
    (...args: Parameters<F>): ReturnType<F>;
    (record: GetRecordTypes<T>): ReturnType<F>;
    (arg1: Parameters<F>[0], record: Partial<GetRecordTypes<T>>): ReturnType<F>;
  } & (
    // Strong typing for up to 5 parameters
    T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
      ? {
          (): ReturnType<F>;
          (arg1: Parameters<F>[0]): ReturnType<F>;
        }
      : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional: true }, { name: string; type: ArgType | ArgType[]; optional: true }]
        ? {
            (): ReturnType<F>;
            (arg1: Parameters<F>[0]): ReturnType<F>;
            (arg1: Parameters<F>[0], arg2: Parameters<F>[1]): ReturnType<F>;
          }
        : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
          ? {
              (): ReturnType<F>;
              (arg1: Parameters<F>[0]): ReturnType<F>;
              (arg1: Parameters<F>[0], arg2: Parameters<F>[1]): ReturnType<F>;
              (arg1: Parameters<F>[0], arg2: Parameters<F>[1], arg3: Parameters<F>[2]): ReturnType<F>;
            }
          : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
            ? {
                (): ReturnType<F>;
                (arg1: Parameters<F>[0]): ReturnType<F>;
                (arg1: Parameters<F>[0], arg2: Parameters<F>[1]): ReturnType<F>;
                (arg1: Parameters<F>[0], arg2: Parameters<F>[1], arg3: Parameters<F>[2]): ReturnType<F>;
                (arg1: Parameters<F>[0], arg2: Parameters<F>[1], arg3: Parameters<F>[2], arg4: Parameters<F>[3]): ReturnType<F>;
              }
            : T['params'] extends readonly [{ name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional?: boolean }, { name: string; type: ArgType | ArgType[]; optional: true }]
              ? {
                  (): ReturnType<F>;
                  (arg1: Parameters<F>[0]): ReturnType<F>;
                  (arg1: Parameters<F>[0], arg2: Parameters<F>[1]): ReturnType<F>;
                  (arg1: Parameters<F>[0], arg2: Parameters<F>[1], arg3: Parameters<F>[2]): ReturnType<F>;
                  (arg1: Parameters<F>[0], arg2: Parameters<F>[1], arg3: Parameters<F>[2], arg4: Parameters<F>[3]): ReturnType<F>;
                  (arg1: Parameters<F>[0], arg2: Parameters<F>[1], arg3: Parameters<F>[2], arg4: Parameters<F>[3], arg5: Parameters<F>[4]): ReturnType<F>;
                }
              : {}
  );

  /**
   * Function that accepts either positional arguments or a record object.
   * Parameter names are inferred from the params array: name, value, etc.
   */
  const result = function(...args: any[]): ReturnType<F> {
    // Check if this is a pure record call (single object argument that's not a class instance)
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
      // Check if it's actually a class instance (like Color, Dimension) - if so, treat as positional
      const isClassInstance = options?.params?.some(opt =>
        typeof opt.type === 'function' && args[0] instanceof opt.type
      );

      if (!isClassInstance) {
        // Pure record call - convert to positional
        const record = args[0];
        const positionalArgs = [];

        for (let i = 0; i < (options?.params?.length ?? 0); i++) {
          const paramName = options?.params?.[i]?.name;
          if (paramName) {
            positionalArgs.push(record[paramName] ?? options!.params![i]?.default);
          }
        }

        // Validate positional arguments
        validateArguments(positionalArgs, options?.params);
        return fn(...positionalArgs);
      }
    }

    // Check if this is a hybrid call (multiple args with last being an object)
    if (args.length > 1 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1])) {
      // Hybrid call: positional args + record
      const positionalArgs = args.slice(0, -1);
      const record = args[args.length - 1];

      // Merge positional args with record (record takes precedence)
      // Create an array of arguments in the correct order
      const mergedArgs = [...positionalArgs];

      // Fill in missing positional args from record, but record takes precedence
      for (let i = 0; i < (options?.params?.length ?? 0); i++) {
        const paramName = options?.params?.[i]?.name;
        if (paramName && record[paramName] !== undefined) {
          // Record takes precedence - overwrite positional arg
          mergedArgs[i] = record[paramName];
        } else if (mergedArgs[i] === undefined && options?.params?.[i]?.default !== undefined) {
          // Apply default value if parameter is missing
          const option = options!.params![i];
          if (option && option.default !== undefined) {
            mergedArgs[i] = option.default;
          }
        }
      }

      // Validate merged arguments
      validateArguments(mergedArgs, options?.params);
      return fn(...mergedArgs);
    } else {
      // Pure positional call - apply defaults for missing parameters
      const processedArgs = [...args];

      // Apply defaults for missing parameters
      for (let i = 0; i < (options?.params?.length ?? 0); i++) {
        if (processedArgs[i] === undefined && options?.params?.[i]?.default !== undefined) {
          const option = options!.params![i];
          if (option && option.default !== undefined) {
            processedArgs[i] = option.default;
          }
        }
      }

      validateArguments(processedArgs, options?.params);
      return fn(...processedArgs);
    }
  } as NamedFunction;

  return result;
}

/**
 * Runtime validation function to check argument types and required parameters
 */
function validateArguments(args: any[], params?: readonly { name: string; type: ArgType | ArgType[]; optional?: boolean; default?: any }[]) {
  if (!params) return;

  // Check that all required parameters are provided
  for (let i = 0; i < params.length; i++) {
    const paramDef = params[i];
    if (!paramDef) continue;

    const arg = args[i];
    const expectedType = paramDef.type;
    const paramName = paramDef.name;
    const isOptional = paramDef.optional || paramDef.default !== undefined;

    // Check if required parameter is missing
    if (!isOptional && arg === undefined) {
      throw new TypeError(`Required argument '${paramName}' is missing`);
    }

    // Skip validation for undefined optional arguments
    if (arg === undefined) continue;

    if (Array.isArray(expectedType)) {
      // Check if arg matches any of the allowed types
      const isValid = expectedType.some(type => isValidType(arg, type));
      if (!isValid) {
        throw new TypeError(
          `Argument '${paramName}' must be one of: ${expectedType.join(', ')}. Got: ${typeof arg}`
        );
      }
    } else {
      // Single type validation
      if (!isValidType(arg, expectedType)) {
        const typeName = typeof expectedType === 'function' ? expectedType.name : expectedType;
        throw new TypeError(
          `Argument '${paramName}' must be of type '${typeName}'. Got: ${typeof arg}`
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