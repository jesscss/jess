type SourceMapLocation = readonly [unknown, unknown, unknown, unknown, unknown, unknown];
type OptionalLocation = readonly unknown[] | undefined;

function isSourceMapLocation(value: OptionalLocation): value is SourceMapLocation {
  return Array.isArray(value) && value.length === 6;
}

export class OutputCollector {
  strings: string[] = [];
  map: SourceMapLocation[] = [];

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
    if (isSourceMapLocation(originalLocation)) {
      this.map.push(originalLocation);
    }
  }

  toString() {
    return this.strings.join('');
  }
}
