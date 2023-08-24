import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'less-parser',
    include: ['test/**/*.ts', '**/__tests__/**/*.ts'],
    globals: true,
    reporters: ['default', 'basic']
    // coverage: {
    //   enabled: true,
    //   include: ['src/**/*.ts'],
    //   100: true
    // }
  }
})