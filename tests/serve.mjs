// Minimal static server for the built site (SPA fallback to index.html).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'build');
const port = Number(process.argv[3] ?? 4173);
const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json'
};

http
	.createServer((req, res) => {
		const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		let file = path.join(root, pathname);
		if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			file = path.join(root, 'index.html');
		}
		res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	})
	.listen(port, () => console.log(`serving ${root} on :${port}`));
