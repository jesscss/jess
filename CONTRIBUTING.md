
# Contributing to Jess

First of all, you should be having fun, or at least enjoying yourself. If you're not having fun / experiencing enjoyment, see if you there's someone available to talk to in the Jess Gitter community who can make contributing to open source more rewarding for you.

If enjoyment is stifled because someone is violating the [Code of Conduct](./CODE_OF_CONDUCT.md), oof, let's fix that!

### Contributing to Jess should be about more than code

Our goal is to build a unique and welcoming community around this project. Code is just code; what matters is people. Do your best to support people who are new here, and reach out if you need support. Also, we welcome more than just coders! There are a lot of tasks that often get forgotten or are undervalued around open source, and most of those are related to community-building and community engagement.

### On the details of contributing

As far as code style, repo management, tools, etc, ehh we can figure that out! Don't sweat it. Ask questions, and when you find answers, do your best to fill in any gaps in code documentation and in the Docusaurus docs, so that the next person doesn't encounter the same gaps.


### One note about `let` vs `const`

This code-base _prefers_ `const` only for module-level scope, and `let` for temporary assignment scope. For this reason, I tried using https://www.npmjs.com/package/eslint-plugin-prefer-let, but TypeScript cannot do type narrowing in some instances if `let` is used instead of `const`. Therefore, while `let` is preferred, `const` is fine, and ESLint doesn't enforce anything. See [this article](https://medium.com/@PepsRyuu/use-let-by-default-not-const-58773e53db52) for more information.