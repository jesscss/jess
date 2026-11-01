import type { EmitJessOptions } from '@jesscss/core';
import { lessExportNames } from '@jesscss/fns/less/registry';

/** The plugin's private specifier for the Less built-in module `@jesscss/fns/less`. */
export const LESS_MODULE = '#less';

/**
 * The Less built-ins as a converted `.jess` file reaches them (`emitJess`'s
 * `functions`): `.jess` has no ambient function namespace (ledger P17), so each
 * call is imported by name from this plugin's trusted {@link LESS_MODULE}
 * (ledger C13), the named-binding projection
 * `DIALECT-TO-JESS-COMPILED-CONVERSION.md` records.
 * Capability contract: `capabilities/jess-function-bindings/capability.json`.
 */
export function jessFunctions(): NonNullable<EmitJessOptions['functions']> {
  return { from: LESS_MODULE, names: lessExportNames() };
}
