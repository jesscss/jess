/**
 * THE ABSOLUTE RULE, and nothing else.
 *
 * The project rule is: never `as any`, never `: any`, never `@ts-ignore`,
 * never `@ts-nocheck`. This module is the single definition of that ban.
 *
 * Deliberately NARROW. It matches exactly the four forms the rule names, and
 * nothing adjacent:
 *
 *   - `x as any`      -> TSAsExpression > TSAnyKeyword
 *   - `<any>x`        -> TSTypeAssertion > TSAnyKeyword  (legacy spelling of the same thing)
 *   - `x: any`        -> TSTypeAnnotation > TSAnyKeyword (variable, parameter, property, return type)
 *   - `@ts-ignore` / `@ts-nocheck`
 *
 * NOT banned, because the rule does not name them and widening the ban would
 * turn it back into the broad mostly-false-positive rule this replaced:
 *   - `Array<any>`, `Promise<any>` and other type ARGUMENTS
 *   - `any` inside a declared type alias or interface
 *   - `@ts-expect-error`, which is self-verifying: TypeScript errors if the
 *     expected error does not occur, so it cannot rot silently the way
 *     `@ts-ignore` can. It is used deliberately in this repo's type tests
 *     (e.g. packages/awaitable-pipe/test/pipe.types.test.ts asserts that an
 *     incompatible pipe step is a compile error). It is required to carry a
 *     description so the intent is reviewable.
 *
 * Neither rule needs type information, so the pass that runs this config does
 * not need `projectService`, a built `lib/`, or any package to be compiled.
 * That is intentional: an enforcement pass that can be silently defeated by a
 * stale build is not enforcement.
 */

const SUFFIX = 'This cannot be suppressed with an eslint-disable comment.';

const AS_ANY = `\`as any\` is banned outright by this project's absolute rule. Use a concrete type, \`unknown\` + a type guard, or fix the underlying type. ${SUFFIX}`;

const COLON_ANY = `\`: any\` is banned outright by this project's absolute rule. Use a concrete type or \`unknown\`. ${SUFFIX}`;

export const absoluteBanRules = {
  'no-restricted-syntax': ['error',
    {
      selector: 'TSAsExpression > TSAnyKeyword',
      message: AS_ANY
    },
    {
      selector: 'TSTypeAssertion > TSAnyKeyword',
      message: AS_ANY
    },
    {
      selector: 'TSTypeAnnotation > TSAnyKeyword',
      message: COLON_ANY
    }
  ],

  '@typescript-eslint/ban-ts-comment': ['error', {
    'ts-ignore': true,
    'ts-nocheck': true,
    'ts-check': false,

    /*
     * Allowed, with a description. See the note above: `@ts-expect-error` is
     * verified by the compiler, unlike `@ts-ignore`.
     */
    'ts-expect-error': 'allow-with-description',
    minimumDescriptionLength: 10
  }]
};

export default absoluteBanRules;
