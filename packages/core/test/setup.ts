import '@ungap/set-methods';
import '../src/index.js'; // Import main entry point which includes tree to attach prototype methods like nil()

// Ensure Node.prototype.nil is properly attached for tests
import { Node } from '../src/tree/node.js';
import { Nil } from '../src/tree/nil.js';

if (!Node.prototype.nil) {
  Node.prototype.nil = function() {
    return new Nil();
  };
}