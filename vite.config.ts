import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// The deployed app lives under /<repo>/ on GitHub Pages; the CI sets BASE_PATH.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
			paths: { base }
		}),
		devtoolsJson()
	],
	worker: { format: 'es' },
	server: { allowedHosts: true },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
