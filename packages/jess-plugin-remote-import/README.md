# @jesscss/plugin-remote-import

**Opt-in `@import` of stylesheets over https, from hosts you name.**

Without this plugin, Jess and Less 5 never download anything: an
`@import "https://…"` stays in the output as a plain CSS `@import`. With it, a
URL import whose host is on your allow list is fetched and imported like a
local file.

```js
// styles.config.mjs
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';

export default {
  compile: {
    plugins: [remoteImportPlugin({ allow: ['cdn.example.com'] })]
  }
};
```

What it enforces:

- **An explicit allow list.** Exact host names; no wildcards, no ports, and
  never a private, loopback or link-local address. A host that resolves to one
  of those addresses is refused as well.
- **A blocked host is an error**, not a silent CSS terminal — even under
  `(optional)`.
- **https only**, **same-origin redirects only** (at most five), a **size cap**
  (`maxBytes`, default 512 KiB) and a **time limit** (`timeout`, default 5 s).
- **Imports inside a downloaded file resolve against its URL**, so a remote
  file can never name a file on your disk.
- A URL without a file extension (`https://fonts.googleapis.com/css?…`) stays a
  CSS `@import`.

Under Deno, run with `--allow-net` set to the same hosts: the runtime then
refuses any other host even if this plugin's check were wrong. A test in this
package proves it. On Node, the plugin's check is the only one.

The design and its rulings:
[`docs/design/REMOTE-IMPORTS-NETWORK-POLICY.md`](../../docs/design/REMOTE-IMPORTS-NETWORK-POLICY.md).

## Status

**Alpha.** Part of [Jess](https://github.com/jesscss/jess). License: MIT.
