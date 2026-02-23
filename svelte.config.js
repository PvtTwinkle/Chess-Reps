// adapter-node compiles SvelteKit into a plain Node.js HTTP server.
// This is the correct adapter for a self-hosted Docker deployment.
// The built output lands in /build and is started with: node build/index.js
import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	}
};

export default config;
