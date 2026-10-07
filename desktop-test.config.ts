import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './desktop-tests', timeout: 60000, workers: 1, fullyParallel: false, reporter: 'list' });
