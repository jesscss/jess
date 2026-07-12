/**
 * Selector-like ampersand template payloads.
 *
 * Supports:
 * - suffix/prefix forms like `-1`, `.foo`
 * - explicit insertion templates containing `&`
 * - selector-ish fragments, but not arbitrary identifiers like `nil`
 */
export const AMPERSAND_TEMPLATE_CONTENTS_REGEX = /(?:[.#-]|\d)(?:[.#\w\u0080-\uffff-]|&)*|(?:[.#\w\u0080-\uffff-]|&)*&(?:[.#\w\u0080-\uffff-]|&)*/;
