import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli/index.ts', 'src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  fixedExtension: false,
  clean: true,
  dts: true,
})
