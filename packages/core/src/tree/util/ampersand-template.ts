/**
 * Selector-like ampersand template payloads.
 *
 * Supports:
 * - suffix/prefix forms like `-1`, `.foo`, `b`
 * - explicit insertion templates containing `&`
 * - selector-ish fragments, but reserves `nil` for `&(nil)`
 */
export const AMPERSAND_TEMPLATE_CONTENTS_REGEX = /(?:[.#\w\u0080-\uffff-]|\d)(?:[.#\w\u0080-\uffff-]|&)*|(?:[.#\w\u0080-\uffff-]|&)*&(?:[.#\w\u0080-\uffff-]|&)*/;
