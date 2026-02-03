import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		// Use happy-dom for faster DOM simulation
		environment: 'happy-dom',

		// Include test files
		include: ['src/**/*.{test,spec}.{js,ts}'],

		// Global test setup
		globals: true,

		// Coverage configuration
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'src/tests/fixtures/',
				'**/*.d.ts',
				'**/*.config.*',
				'**/mockData',
				'build/',
				'.svelte-kit/'
			],
			// Target 80%+ coverage
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80
			}
		},

		// Test timeout (2 minutes for integration tests)
		testTimeout: 120000,

		// Setup files
		setupFiles: ['src/tests/setup.ts']
	}
});
