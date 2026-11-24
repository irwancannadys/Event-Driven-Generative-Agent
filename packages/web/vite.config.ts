import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

// The page talks to the server through Vite (decision 028): `/api/...` goes to the HTTP API with the
// `/api` taken off, `/ws` goes to the WebSocket. So the browser only ever sees one origin and nothing
// needs CORS. The server's address is CAFE_API_URL, or http://127.0.0.1:PORT with the PORT of the
// repo's .env (3000 by default), the same setting the server itself reads.
export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, repoRoot, '');
  const target = env.CAFE_API_URL || `http://127.0.0.1:${env.PORT || 3000}`;
  return {
    server: {
      proxy: {
        '/api': { target, rewrite: (path) => path.replace(/^\/api/, '') },
        '/ws': { target, ws: true },
      },
    },
  };
});
