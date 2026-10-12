import { base } from '@masar/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  base({ tsconfigRootDir: import.meta.dirname }),
  nextPlugin.configs['core-web-vitals'],
);
