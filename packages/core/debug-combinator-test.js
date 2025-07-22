const { el, sel, co } = require('./lib/tree/index.js');
const { findExtendableLocations } = require('./lib/tree/util/find-extendable-locations.js');

// Test the specific failing case
const selector1 = sel([el('.parent'), co('>'), el('.child')]);
const selector2 = sel([el('.parent'), co('+'), el('.child')]);

console.log('selector1:', selector1.valueOf()); // .parent > .child
console.log('selector2:', selector2.valueOf()); // .parent + .child

const result = findExtendableLocations(selector1, selector2);
console.log('Result:', {
  hasMatches: result.hasMatches,
  locationCount: result.locations.length
});

if (result.hasMatches) {
  console.log('Locations:');
  result.locations.forEach((loc, i) => {
    console.log(`  ${i}:`, {
      path: loc.path,
      extensionType: loc.extensionType,
      matchedNode: loc.matchedNode.valueOf()
    });
  });
}
