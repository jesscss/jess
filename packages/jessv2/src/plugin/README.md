# plugin/rollup.ts

To evaluate Jess stylesheets, Jess does the following:
1. converts `.jess` files to modules (`.js` and `.js.map`)
2. uses Rollup and this plugin to create an executable bundle
3. Runs the bundle, passing in runtime vars to create `.css` and `.css.map`

Note, the public `rollup-plugin-jess` library, then, when transpiling `.jess`, will end up calling this Rollup process and return these assets as emitted files.

_NOTE: will it be possible, at some point, to merge this with `rollup-plugin-jess`?_