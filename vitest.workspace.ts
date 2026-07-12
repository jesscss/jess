import { defineWorkspace } from 'vitest/config'
export default defineWorkspace([
  'packages/*/vitest.config.ts',
  {
    test: {
      setupFiles: ['./test/setup.ts']
    }
  }
])