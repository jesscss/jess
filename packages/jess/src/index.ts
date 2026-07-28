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
