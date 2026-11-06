import {
  DefaultCompiler,
  type ConfigOptions
} from '@jesscss/compiler-preset';

export type { ConfigOptions } from '@jesscss/compiler-preset';

/**
 * Batteries-included Jess compiler. The reusable render engine lives in
 * `@jesscss/compiler`; this package only chooses Jess's default plugin stack
 * and CLI-oriented dialect behavior.
 */
export class Compiler extends DefaultCompiler {
  /** This class, so a render that runs in the script sandbox runs with the same compiler. */
  static override readonly moduleIdentity = { module: import.meta.url, exportName: 'Compiler' };

  /** @internal */
  declare public opts: ConfigOptions;

  constructor(opts: ConfigOptions = {
    compile: {},
    output: {},
    language: {}
  }) {
    super(opts, import.meta.url);
  }
}
