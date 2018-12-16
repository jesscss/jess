```less
@import {stylesheet as fragment} from './fragment.jess';
@import {stylesheet as fragment2} from './fragment2.jess';

${fragment}
${fragment2}

```
or
```less
@import './fragment.jess';  // passes config object to inlined imports
```
