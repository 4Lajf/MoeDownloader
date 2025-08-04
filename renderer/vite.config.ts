import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [tailwindcss(), svelte(), devtoolsJson()],
	base: './', // Use relative paths for electron
	build: { outDir: '../dist/renderer/' },
	resolve: {
		alias: {
			$lib: path.resolve("./src/lib"),
		},
	},
});
