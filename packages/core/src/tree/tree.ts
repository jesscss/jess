import type * as tree from '../.'
import type { ConditionalPick, Class } from 'type-fest'
import type { Node } from './node'

export type Nodes = ConditionalPick<typeof tree, Class<Node>>