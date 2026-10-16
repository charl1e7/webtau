import { defineConfig, devices } from '@playwright/test';

// Locally a pre-installed Chromium can be used: PW_CHROMIUM_PATH=/path/to/chrome
const launchOptions = {
	args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
	...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {})
};

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
	fullyParallel: true,
	workers: process.env.CI ? 2 : undefined,
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	expect: { timeout: 8_000 },
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		// A service worker would cache between tests.
		serviceWorkers: 'block'
	},
	webServer: {
		command: 'node tests/serve.mjs build 4173',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI
	},
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 820 }, launchOptions }
		},
		{
			name: 'mobile',
			use: {
				...devices['iPhone 13'],
				defaultBrowserType: 'chromium',
				hasTouch: true,
				launchOptions
			}
		}
	]
});
