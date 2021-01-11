```less
@import fragment from './fragment.jess';
@import fragment2 from './fragment2.jess';

@include fragment();
@include fragment2();

```
or
```less
// Passes vars for global theming? hmm...
@include './fragment.jess';
@include './fragment2.jess';
```
