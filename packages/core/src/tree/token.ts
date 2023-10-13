import { defineType } from './node'
import { General, type GeneralNodeType } from './general'
import { type LiteralUnion } from 'type-fest'

type TokenType = LiteralUnion<GeneralNodeType, string>

/**
 * Arbitrary general single-token nodes that are captured
 * as part of consuming "any" value, such as in an
 * unknown at-rule or a custom property.
 */
export class Token extends General<TokenType> {}
export const token = defineType(Token, 'Token')