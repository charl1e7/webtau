/// <reference lib="webworker" />
import { assets, immutable } from '$app/manifest';
import { self as worker } from '$app/service-worker';

// Caches the app shell and the audio engine so WebTAU opens instantly and
// works offline after the first visit. Voicebank analysis results live in
// IndexedDB and are independent from this cache.

const scope = worker.registration.scope;
const toUrl = (path: string) => new URL(path.replace(/^\//, ''), scope).href;

const ASSETS = [...immutable, ...assets].map((a) => toUrl(a.path));
// The hashed file names change with every build, so they double as a version.
const CACHE = `webtau-${ASSETS.reduce((h, s) => (Math.imul(h, 31) + s.length + s.charCodeAt(s.length - 5)) | 0, 7).toString(36)}`;

worker.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([scope, ...ASSETS]))
			.then(() => worker.skipWaiting())
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => worker.clients.claim())
	);
});

worker.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const hit = await cache.match(request);
			if (hit) return hit;
			try {
				return await fetch(request);
			} catch (error) {
				// Offline: any navigation falls back to the cached app shell.
				const shell = await cache.match(scope);
				if (request.mode === 'navigate' && shell) return shell;
				throw error;
			}
		})()
	);
});
