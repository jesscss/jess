import { type Node } from './node'

export interface Selector extends Node {
  isSelector: true
}