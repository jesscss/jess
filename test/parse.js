const jess = require('../')

const result = jess.parse(
`
@import 'foo';
`
);

console.log(result.value);