import { Node, defineType } from './node'

/**
 * Identifiers which are values (or operators in things like media,
 * container, support queries etc). This has no specific utility
 * other than organizing the AST.
 */
export class Keyword extends Node<string> {}
export const keyword = defineType(Keyword, 'Keyword')