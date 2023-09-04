import { Node } from './node'
import type { JsIdent } from '.'

/**
 * A super-type for inheritance checks
 */
export abstract class JsNode extends Node {
  name: JsIdent
}