console.log('=== Debug Test ===');

// Simulate the failing test case
const target = '.a.b > .c';  // compound([.a, .b]) > .c
const find = '.b > .c';      // .b > .c

console.log(`Target: ${target}`);
console.log(`Find: ${find}`);
console.log('Expected: should match with remainder .a');

// The problem is that when we try to match compound(.a, .b) against .b,
// the compound matching should succeed with remainder .a
// Then the > should match >, and .c should match .c
// Result: partial match with remainder .a

console.log('\n=== Analysis ===');
console.log('1. .c matches .c ✓');
console.log('2. > matches > ✓');
console.log('3. compound(.a, .b) should match .b with remainder .a');
console.log('   - This is the failing step');
console.log('Result: should be partial match with remainder .a');
