import type { EmitJessOptions } from '@jesscss/core';
import { sassExportNames } from '@jesscss/fns/sass/registry';
import { SASS_MODULE } from './provided-modules.js';

export { SASS_MODULE };

/**
 * The Sass global built-ins as a converted `.jess` file reaches them
 * (`emitJess`'s `functions`): `.jess` has no ambient function namespace
 * (ledger P17), so each call is imported by name from this plugin's
 * {@link SASS_MODULE}.
 * Capability contract: `capabilities/jess-function-bindings/capability.json`.
 */
export function jessFunctions(): NonNullable<EmitJessOptions['functions']> {
  return { from: SASS_MODULE, names: sassExportNames() };
}
