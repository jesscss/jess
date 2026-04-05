# An exploration of a way to do lazy canonical nodes

What if, when nodes were first mutated, they stored a canonical copy of the original node?



```ts
class Node {
  cloned = false;
  sourceNode = this;

  _checkClone() {
    if (!this.cloned) {
      this.cloned = true;
      this.sourceNode = this.sourceNode.clone();
    }
  }

  clone() {
    let newNode = new this.constructor(...)
    newNode.parent = this.parent; // etc
  }

  cloneCanonical(deep?: boolean) {
    let original = this.sourceNode;
    let newNode = new original.constructor(...)
    newNode.parent = original.parent; // etc
    if (deep) {
      for (let n of original.children()) {
        // cloneCanonical recursively
      }
    }
  }
}

class Ruleset extends Node {

  get selector() {
    return this._selector;
  }

  /** Node "mutates", yes, but stores it's original lineage */
  set selector(value: Selector) {
    this._checkClone();
    this._selector = value;
  }
}
```