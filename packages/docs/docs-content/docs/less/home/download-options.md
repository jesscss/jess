---
title: "Installing & Forking"
slug: "/home/download-options"
audiences:
  - less
origin: less
---
#### [Install the 5.x alpha in your project](https://www.npmjs.com/package/less)

For 5.x docs/testing, install the alpha track as a project dependency:

```bash
pnpm add -D less@alpha
# or: npm install --save-dev less@alpha
```

Then run the compiler from your project toolchain:

```bash
pnpm exec lessc styles.less styles.css
# or: npx lessc styles.less styles.css
```

#### [Clone or fork via GitHub](https://github.com/less/less.js)

Fork the project, test changes locally, and open a pull request when ready.

#### [Download source releases](https://github.com/less/less.js/releases)

Get the latest Less source code by downloading it directly from GitHub.
