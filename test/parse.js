const jess = require('../')

const result = jess.parse(
`
@import 'foo';
@import blah from 'foo.js';

@const colors: {
  background: #000;
  foreground: #FFF;
};

@const colors: \${{
  background: <#000>,
  foreground: <#FFF>,
}};
`
);

console.log(result.value);