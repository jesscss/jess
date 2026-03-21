import { defineType } from './node.js';
import { Rules } from './rules.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { sessionGetChildren } from './util/session-helpers.js';

/**
 * A rules container that emits its content verbatim inside braces,
 * without parent-managed newlines or indentation.
 */
export interface RawRules {
  type: 'RawRules';
  shortType: 'rules-raw';
}
export class RawRules extends Rules {
  constructor(...args: ConstructorParameters<typeof Rules>) {
    super(...args);
    this.allowRuleRoot = true;
  }

  // Do not add newlines/indent; emit children exactly as-is
  override toBraced(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const children = options.context
      ? sessionGetChildren(this, options.context)
      : this.value;
    w.add('{');
    // Emit children using toString to preserve exact whitespace/comments
    for (const child of children) {
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
    const children = options.context
      ? sessionGetChildren(this, options.context)
      : this.value;
    for (const child of children) {
      child.toString(options);
    }
    return w.getSince(mark);
  }
}

export const rawrules = defineType(RawRules, 'RawRules', 'rules-raw');
