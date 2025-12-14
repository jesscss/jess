# Project Rules

## Development Workflow

- The user will always verify an implementation / fix plan before proceeding with code changes.

## Debugging

- Debugging instrumentation should never stringify a node with .toString() or .toTrimmedString() because that could cause state errors with frameState tracking.
- **CRITICAL - NEVER USE JSON.stringify IN INSTRUMENTATION**: JSON.stringify will attempt to serialize entire objects, which can include circular references from Chevrotain parser objects (they have `decisionMap` and `atn` properties that create circular structures). Even accessing properties like `.frames` on AST nodes can pull in parser context. Instead, extract ONLY primitive values (booleans, numbers, strings) into local variables and log those. Never log objects, arrays, or any non-primitive values. If you need to check if a property exists, use `Object.prototype.hasOwnProperty.call(node, 'propertyName')` instead of accessing the property directly.

