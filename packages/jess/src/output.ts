import type { LocationInfo } from './tree'

export class OutputCollector {
  strings: string[] = []
  map: any[] = []

  /** @todo - for output tracking */
  line: number = 0
  column: number = 0

  add(str: string, originalLocation?: LocationInfo) {
    this.strings.push(str)
    /**
     * @todo
     * @see https://hacks.mozilla.org/2013/05/compiling-to-javascript-and-debugging-with-source-maps/
     * @see https://github.com/mozilla/source-map
     */
    if (originalLocation) {
      this.map.push(originalLocation)
    }
  }

  toString() {
    return this.strings.join('')
  }
}