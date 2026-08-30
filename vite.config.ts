import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * The Chrome origin trial token is bound to the EXACT deployed origin — wildcards do not
 * cover *.vercel.app / *.netlify.app / *.pages.dev. Set VITE_ORIGIN_TRIAL_TOKEN in the
 * deploy environment; locally, enable chrome://flags/#enable-webmcp-testing instead.
 */
function originTrial(token: string): Plugin {
  return {
    name: 'mundaneum-origin-trial',
    transformIndexHtml: (html) =>
      html.replace(
        '<!--ORIGIN_TRIAL-->',
        token ? `<meta http-equiv="origin-trial" content="${token}" />` : '',
      ),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), originTrial(env.VITE_ORIGIN_TRIAL_TOKEN ?? '')],
    resolve: {
      alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // transformers.js ships its own onnx runtime; pre-bundling it breaks the worker.
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
    worker: { format: 'es' },
    build: { target: 'es2022' },
    server: {
      host: true,
      proxy: {
        // mirror the deployed worker's /hf/* model proxy in dev
        '/hf': {
          target: 'https://huggingface.co',
          changeOrigin: true,
          rewrite: (p: string) => p.slice('/hf'.length),
          followRedirects: true,
        },
      },
    },
  }
})
