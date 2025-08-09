import { defineType } from './node';
import { Rules } from './rules';
import { type PrintOptions, getPrintOptions } from './util/print';

/**
 * A rules container that emits its content verbatim inside braces,
 * without parent-managed newlines or indentation.
 */
export class RawRules extends Rules {
  override type = 'RawRules' as const;
  override shortType = 'rules-raw' as const;
  override allowRuleRoot = true;

  // Do not add newlines/indent; emit children exactly as-is
  override toBraced(depth: number = 0, options?: PrintOptions) {
    options = getPrintOptions({ ...options, depth });
    const w = options.writer!;
    const mark = w.mark();
    w.add('{');
    // Emit children using toString to preserve exact whitespace/comments
    for (const child of this.value) {
      child.toString(options);
    }
    w.add('}');
    return w.getSince(mark);
  }

  // Keep trimmed output minimal – emit children verbatim without extras
  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    for (const child of this.value) {
      child.toString(options);
    }
    return w.getSince(mark);
  }
}

export const rawrules = defineType(RawRules, 'RawRules', 'rules-raw');
