import { defineType } from './node'
import { General } from './general'

type Params = ConstructorParameters<typeof General<'Anonymous'>>
/**
 * Any general value that doesn't have a specific Jess node,
 * so it's an "unknown" value.
 */
export class Anonymous extends General<'Anonymous'> {
  constructor(
    value: Params[0],
    options?: Params[1],
    location?: Params[2],
    context?: Params[3]
  ) {
    super(value, options ?? { type: 'Anonymous' }, location, context)
  }
}
export const any = defineType(Anonymous, 'Anonymous', 'any')