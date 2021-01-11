import type { ILocationInfo } from './tree'

export class OutputCollector {
  strings: string[] = []
  map: any[] = []

  /** @todo - for output tracking */
  line: number = 0
  column: number = 0

  add(str: string, originalLocation?: ILocationInfo) {
    this.strings.push(str)
    /**
     * @todo - calculate output line/column for sourcemaps
     * I'm honestly not sure how to do this yet.
     * 
     * @note
     * Original location may be pushed more than once, so
     * we should calculate original source line/column based 
     * on locations pushed?? 
     */
    if (originalLocation) {
      this.map.push(originalLocation)
    }
  }

  toString() {
    return this.strings.join('')
  }
}