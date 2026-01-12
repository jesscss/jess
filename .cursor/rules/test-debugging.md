# Test Debugging Rule

When debugging failing tests, always isolate to a single test or single test case using `.only`:

- Use `it.only()` to run a single test case
- Use `describe.only()` to run a single test suite
- Remove `.only` after debugging is complete

This prevents confusion from multiple test failures and makes it easier to focus on the specific issue being debugged.

Example:
```typescript
describe('MyFeature', () => {
  it.only('should do something specific', () => {
    // Debug this test in isolation
  });
  
  it('should do something else', () => {
    // This will be skipped while debugging
  });
});
```
