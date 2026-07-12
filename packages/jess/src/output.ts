import type { LocationInfo } from '@jesscss/core';

type OptionalLocation = LocationInfo | undefined;

export class OutputCollector {
  strings: string[] = [];
  map: any[] = [];

  /** @todo - for output tracking */
  line: number = 0;
  column: number = 0;

  add(str: string, originalLocation?: OptionalLocation) {
    this.strings.push(str);
    /**
     * @todo
     * @see https://hacks.mozilla.org/2013/05/compiling-to-javascript-and-debugging-with-source-maps/
     * @see https://github.com/mozilla/source-map
     */
    if (originalLocation?.length === 6) {
      this.map.push(originalLocation);
    }
  }

  toString() {
    return this.strings.join('');
  }
}
