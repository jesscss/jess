import { Compiler } from './src/index.js';
const compiler = new Compiler();
const result = compiler.compile('@page { margin: 1in; }');
console.log('Output:', result.output);
console.log('---');
const result2 = compiler.compile('@page :first { margin: 1in; }');
console.log('Output2:', result2.output);
