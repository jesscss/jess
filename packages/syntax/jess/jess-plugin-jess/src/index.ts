import {
  AbstractPlugin,
  buildEvaluator,
  createFnRegistry,
  parserDiagnostic,
  type Context,
  type ISafeParseResult,
  type ModuleConfigRejection,
  type ModuleConfigRequest,
  type Plugin,
  type SafeParseOptions
} from '@jesscss/core';
import { parse, type JessParseOptions } from '@jesscss/jess-parser';

function parseOptionsFromSafeParse(options?: SafeParseOptions): JessParseOptions {
  const compilerOptions = options?.compilerOptions;
  return {
    ...(compilerOptions?.allowApplySelectors !== undefined
      ? { allowApplySelectors: compilerOptions.allowApplySelectors }
      : {}),
    ...(compilerOptions?.allowExtendSelectors !== undefined
      ? { allowExtendSelectors: compilerOptions.allowExtendSelectors }
      : {})
  };
}

/**
 * The `.jess` value evaluator, built over an EMPTY fn registry — deliberately.
 *
 * `.jess` has no ambient global builtin namespace, and that is the language
 * design, not a gap: functions arrive through `@-use`/`@-compose` module imports
 * (ledger A1/A2), and a stylesheet-defined function is a lambda binding, not a
 * global registration. Registering `makeLessRegistry()`/`makeSassRegistry()`
 * here would hand `.jess` another language's globals and contradict that.
 *
 * What the evaluator is needed for is everything ELSE it carries: `operate`
 * (the `$( … )` expression form — ledger P13(d) — is the only arithmetic
 * spelling in `.jess`), `materialize`, `compare` and `typeCheck`. Without a
 * registered evaluator `serialize.ts` takes its `!e.ev` fallback branches and
 * re-emits operand bytes unevaluated (`packages/core/src/ast/serialize.ts:3191`),
 * so `$(1 + 2)` rendered as `1 + 2`.
 *
 * An empty table also leaves unknown-call behaviour exactly as it was: a name
 * the registry does not have falls through to `fallbackCall` and is emitted
 * verbatim, the same bytes `.jess` produced with no evaluator at all. A
 * `@-use`/`@-compose` function is resolved lexically (`scopedFn`), never from
 * this table, so the module route is served without a global namespace.
 */
const jessValueEvaluator = buildEvaluator(createFnRegistry());

/** Parses `.jess` source into the canonical AST-v2 `Stylesheet` document. */
export class JessPlugin extends AbstractPlugin {
  name = 'jess';
  supportedExtensions = ['.jess'];

  setContext(context: Context): void {
    if (context.documentContext?.plugin !== this) {
      return;
    }
    context.registerValueEvaluator(jessValueEvaluator);
  }

  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    try {
      return { document: parse(source, parseOptionsFromSafeParse(parseOptions)), errors: [], warnings: [] };
    } catch (error) {
      return {
        errors: [parserDiagnostic({ dialect: 'Jess', error, filePath, source })],
        warnings: []
      };
    }
  }

  /*
   * A `.jess` module variable is configurable only when declared OPTIONAL with
   * `?:` (an if-absent write; spec R6 Part E §E.5). Configuring any other name —
   * a hard `$x:` or a typo — is rejected: the strict, encapsulated surface.
   */
  applyModuleConfig(request: ModuleConfigRequest): ModuleConfigRejection[] {
    const knobs = new Set<string>();
    for (const statement of request.moduleRules) {
      if (statement.type === 'VariableDeclaration' && statement.write.mode === 'if-absent') {
        knobs.add(statement.name);
      }
    }
    const rejected: ModuleConfigRejection[] = [];
    for (const binding of request.bindings) {
      if (!knobs.has(binding.name)) {
        rejected.push({
          name: binding.name,
          message: `Cannot configure "$${binding.name}": a .jess module variable is configurable only when declared optional as \`$${binding.name} ?: …\`.`
        });
      }
    }
    return rejected;
  }
}

const jessPlugin = (() => new JessPlugin()) satisfies Plugin;

export default jessPlugin;
