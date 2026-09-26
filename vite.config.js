import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the Express backend during `npm run dev`.
      // Run the backend in another terminal with `npm start`.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          // If the backend isn't running, answer with a clear 503 JSON
          // instead of Vite's cryptic empty 500.
          proxy.on('error', (err, req, res) => {
            if (!res.headersSent && res.writeHead) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error:
                    'Backend is not running — open a second terminal and run `npm start`, then retry.'
                })
              );
            }
          });
        }
      }
    }
  },
  preview: { port: 4173 }
});
