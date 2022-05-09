
# Contributing to Jess

First of all, you should be having fun, or at least enjoying yourself. If you're not having fun / experiencing enjoyment, see if you there's someone available to talk to in the Jess Gitter community who can make contributing to open source more rewarding for you.

If enjoyment is stifled because someone is violating the [Code of Conduct](./CODE_OF_CONDUCT.md), oof, let's fix that!

### Contributing to Jess should be about more than code

Our goal is to build a unique and welcoming community around this project. Code is just code; what matters is people. Do your best to support people who are new here, and reach out if you need support. Also, we welcome more than just coders! There are a lot of tasks that often get forgotten or are undervalued around open source, and most of those are related to community-building and community engagement.

### On the details of contributing

As far as code style, repo management, tools, etc, ehh we can figure that out! Don't sweat it. Ask questions, and when you find answers, do your best to fill in any gaps in code documentation and in the Docusaurus docs, so that the next person doesn't encounter the same gaps.

### Release Process
Performing a release requires push permissions to the repository.

- Ensure you are on the master branch and synced with origin.
- yarn run release:version
- Follow the lerna CLI instructions and choose the new version number.
- Track the newly pushed tag (/^v[0-9]+(\.[0-9]+)*/) build in the build system until successful completion.
- Inspect the new artifacts published on npmjs.com, e.g: