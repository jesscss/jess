import { defineWorkspace } from 'vitest/config'
export default defineWorkspace([
  'packages/*/*',
  'test/**/*.ts',
  '**/__tests__/**/*.ts'
])