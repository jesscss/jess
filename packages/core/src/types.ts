export interface StylesConfig {
  output?: {
    collapseNesting?: boolean | 'native' | 'compact';
    compress?: boolean;

    /**
     * Source-map generation. `true` turns it on with defaults; the object form
     * carries the Less-compatible sub-options (basepath/rootpath/inline/…). The
     * full option list is documented on `ConfigOptions` in `./types/config.ts`.
     */
    sourceMap?: boolean | {
      sourceMapFullFilename?: string;
      sourceMapRootpath?: string;
      sourceMapBasepath?: string;
      sourceMapURL?: string;
      sourceMapFileInline?: boolean;
      outputSourceFiles?: boolean;
      disableSourcemapAnnotation?: boolean;
      sourceMapOutputFilename?: string;
      sourceMapFilename?: string;
    };
  };
}
