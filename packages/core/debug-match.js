const { findExtendableLocations } = require('./lib/tree/util/find-extendable-locations');
const { el, compound, is, sellist } = require('./lib');

console.log('=== Debug: Selector list with partial matches ===');
// target: .a, find: .a, .b (selector list treated as independent searches)
const target1 = el('.a');
const find1 = sellist([el('.a'), el('.b')]);
console.log('target:', target1.valueOf());
console.log('find:', find1.valueOf());
const result1 = findExtendableLocations(target1, find1);
console.log('result1:', JSON.stringify(result1, null, 2));

console.log('\n=== Debug: Compound with :is() pseudo-selector ===');
// target: .a.b, find: :is(.a).b
const target2 = compound([el('.a'), el('.b')]);
const find2 = compound([is(el('.a')), el('.b')]);
console.log('target:', target2.valueOf());
console.log('find:', find2.valueOf());
const result2 = findExtendableLocations(target2, find2);
console.log('result2:', JSON.stringify(result2, null, 2));

console.log('\n=== Debug: Simple case that works ===');
// target: .a, find: .a
const target3 = el('.a');
const find3 = el('.a');
console.log('target:', target3.valueOf());
console.log('find:', find3.valueOf());
const result3 = findExtendableLocations(target3, find3);
console.log('result3:', JSON.stringify(result3, null, 2));
