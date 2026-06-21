/**
 * Shared scanner-native selector classifier for string-backed selector paths.
 *
 * This intentionally recognizes only the cheap subset that can render as raw
 * selector text and later materialize into current core selector nodes. Keep
 * admission here so parser/plugin gates and core semantic materialization do not
 * drift as the scanner-first subset widens.
 */

const RAW_NAME_START_SOURCE = String.raw`[-_a-zA-Z\x80-\uFFFF]`;
const RAW_NAME_BODY_SOURCE = String.raw`[-_a-zA-Z0-9\x80-\uFFFF]*`;
const RAW_NAME_SOURCE = String.raw`${RAW_NAME_START_SOURCE}${RAW_NAME_BODY_SOURCE}`;
const RAW_ATTRIBUTE_SELECTOR_SOURCE =
  String.raw`\[-?${RAW_NAME_SOURCE}(?:[ \t]*[~|^$*]?=[ \t]*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|-?${RAW_NAME_SOURCE}))?(?:[ \t]+[is])?[ \t]*\]`;
const RAW_PSEUDO_SELECTOR_SOURCE = String.raw`:{1,2}-?${RAW_NAME_SOURCE}`;
const RAW_SIMPLE_SELECTOR_COMPONENT_SOURCE =
  String.raw`(?:[.#]${RAW_NAME_SOURCE}|${RAW_PSEUDO_SELECTOR_SOURCE}|${RAW_ATTRIBUTE_SELECTOR_SOURCE})`;
const RAW_SELECTOR_BRANCH_SOURCE =
  String.raw`(?:(?:${RAW_NAME_SOURCE}|\*)(?:${RAW_SIMPLE_SELECTOR_COMPONENT_SOURCE})*|(?:${RAW_SIMPLE_SELECTOR_COMPONENT_SOURCE})+)`;
const RAW_COMPLEX_SELECTOR_SOURCE =
  String.raw`${RAW_SELECTOR_BRANCH_SOURCE}(?:(?:[ \t]+|[ \t]*[>+~][ \t]*)${RAW_SELECTOR_BRANCH_SOURCE})*`;
const RAW_RELATIVE_SELECTOR_SOURCE =
  String.raw`[ \t]*[>+~][ \t]*${RAW_SELECTOR_BRANCH_SOURCE}(?:(?:[ \t]+|[ \t]*[>+~][ \t]*)${RAW_SELECTOR_BRANCH_SOURCE})*`;

const RAW_SELECTOR_PATTERN =
  new RegExp(String.raw`^${RAW_COMPLEX_SELECTOR_SOURCE}(?:[ \t]*,[ \t]*${RAW_COMPLEX_SELECTOR_SOURCE})*$`, 'u');
const RAW_RELATIVE_SELECTOR_PATTERN = new RegExp(String.raw`^${RAW_RELATIVE_SELECTOR_SOURCE}$`, 'u');
const RAW_SELECTOR_BRANCH_PATTERN =
  new RegExp(String.raw`^${RAW_SELECTOR_BRANCH_SOURCE}$`, 'u');
const RAW_SIMPLE_SELECTOR_PATTERN =
  new RegExp(String.raw`^(?:\*|[-_a-zA-Z][\w-]*|[.#][-_a-zA-Z][\w-]*|${RAW_PSEUDO_SELECTOR_SOURCE}|${RAW_ATTRIBUTE_SELECTOR_SOURCE})$`, 'u');
const RAW_EXTEND_TARGET_SELECTOR_PATTERN = new RegExp(String.raw`^[.#]${RAW_NAME_SOURCE}$`, 'u');
const RAW_EXTEND_TARGET_COMPLEX_SELECTOR_PATTERN =
  new RegExp(String.raw`^[.#]${RAW_NAME_SOURCE}(?:(?:[ \t]+|[ \t]*[>+~][ \t]*)[.#]${RAW_NAME_SOURCE})+$`, 'u');
const RAW_NESTED_AMPERSAND_PSEUDO_SELECTOR_PATTERN = new RegExp(String.raw`^&:{1,2}${RAW_NAME_SOURCE}$`, 'u');

/**
 * @internal Scanner-first admission helper, not a supported public authoring
 * API. Keep this boolean-only so hot admission checks do not allocate option
 * objects or materialization plans.
 */
export function isScannerNativeRawSelector(
  value: string,
  allowNestedAmpersandPseudoSelector = false,
  allowRelativeSelector = false
): boolean {
  return (
    RAW_SELECTOR_PATTERN.test(value)
    || (
      allowRelativeSelector
      && RAW_RELATIVE_SELECTOR_PATTERN.test(value)
    )
    || (
      allowNestedAmpersandPseudoSelector
      && RAW_NESTED_AMPERSAND_PSEUDO_SELECTOR_PATTERN.test(value)
    )
  );
}

/** @internal Scanner-first admission helper, not a supported public authoring API. */
export function isScannerNativeRawRelativeSelector(value: string): boolean {
  return RAW_RELATIVE_SELECTOR_PATTERN.test(value);
}

/** @internal Scanner-first admission helper, not a supported public authoring API. */
export function isScannerNativeRawSelectorBranch(value: string): boolean {
  return RAW_SELECTOR_BRANCH_PATTERN.test(value);
}

/** @internal Scanner-first admission helper, not a supported public authoring API. */
export function isScannerNativeRawSimpleSelector(value: string): boolean {
  return RAW_SIMPLE_SELECTOR_PATTERN.test(value);
}

/** @internal Scanner-first admission helper, not a supported public authoring API. */
export function readScannerNativeNestedAmpersandPseudoSelector(value: string): string | undefined {
  const match = RAW_NESTED_AMPERSAND_PSEUDO_SELECTOR_PATTERN.exec(value);
  return match ? value.slice(1) : undefined;
}

/** @internal Scanner-first admission helper, not a supported public authoring API. */
export function isScannerNativeRawExtendTargetSelector(value: string): boolean {
  return RAW_EXTEND_TARGET_SELECTOR_PATTERN.test(value);
}

/** @internal Scanner-first admission helper, not a supported public authoring API. */
export function isScannerNativeRawComplexExtendTargetSelector(value: string): boolean {
  return RAW_EXTEND_TARGET_COMPLEX_SELECTOR_PATTERN.test(value);
}
