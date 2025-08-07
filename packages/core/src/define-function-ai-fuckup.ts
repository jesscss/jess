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

export function defineFunction<T extends DefineFunctionOptions, F extends (record: any) => any>(
  name: string,
  fn: F,
  options?: T
) {
  // For external API, use any[] for now to allow positional calls
  // The runtime handles the conversion properly
  type NamedFunction = {
    (...args: any[]): ReturnType<F>;
    (record: Parameters<F>[0]): ReturnType<F>;
  };

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
        // Pure record call - apply defaults and validate
        const record = { ...args[0] }; // Make a copy to avoid mutating the original

        // Apply defaults for missing parameters
        for (const paramDef of options?.params ?? []) {
          const paramName = paramDef.name;
          if (record[paramName] === undefined && paramDef.default !== undefined) {
            record[paramName] = paramDef.default;
          }
        }

        validateRecordArguments(record, options?.params);
        return fn(record as Parameters<F>[0]);
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

      validateRecordArguments(mergedRecord, options?.params);
      return fn(mergedRecord as Parameters<F>[0]);
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

      validateRecordArguments(recordArgs, options?.params);
      return fn(recordArgs as Parameters<F>[0]);
    }
  } as NamedFunction;

  return result;
}

/**
 * Runtime validation function to check argument types and required parameters for record-based calls
 */
function validateRecordArguments(record: any, params?: readonly { name: string; type: ArgType | ArgType[]; optional?: boolean; default?: any }[]) {
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