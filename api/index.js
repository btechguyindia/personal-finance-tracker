// Vercel serverless entry — re-exports the Express app from server.js.
// All /api/* routes + static frontend are served through this handler.
// Requires DATABASE_URL (Neon Postgres) to be set in Vercel env.
import app from '../server.js';

export default app;
