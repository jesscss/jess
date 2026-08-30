import { classifyExtendMatch } from '../packages/core/lib/tree/util/extend-walk.js';
import { SimpleSelector } from '../packages/core/lib/tree/selector-simple.js';

const selector = SimpleSelector.fromString('.dd');
const target = SimpleSelector.fromString('.dd');
const extendWith = SimpleSelector.fromString('.ff');
const parent = SimpleSelector.fromString('.aa');

console.log('exact nested .dd =>', classifyExtendMatch(selector, target, extendWith, false, parent));
console.log('partial nested .dd =>', classifyExtendMatch(selector, target, extendWith, true, parent));

const selector2 = SimpleSelector.fromString('.bb');
const target2 = SimpleSelector.fromString('.bb');
const extendWith2 = SimpleSelector.fromString('.cc');
const parent2 = SimpleSelector.fromString('.bb');

console.log('exact nested .bb =>', classifyExtendMatch(selector2, target2, extendWith2, false, parent2));
console.log('partial nested .bb =>', classifyExtendMatch(selector2, target2, extendWith2, true, parent2));
