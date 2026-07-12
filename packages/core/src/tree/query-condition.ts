
import { defineType } from './node'
import { Sequence } from './sequence'

/**
 * Used by `@media`, `@supports`, and `@container`
 *
 * This just helps identify conditions if we need to
 * merge them later.
 *
 * @todo - add more structure?
 */
export class QueryCondition extends Sequence {}
export const query = defineType(QueryCondition, 'QueryCondition', 'query')