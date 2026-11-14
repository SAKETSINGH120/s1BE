import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';

try {
  await connectDatabase(env.MONGODB_URI);
  console.log('Connected to MongoDB');
} catch (error) {
  console.error(`Failed to connect to MongoDB: ${error.message}`);
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.PORT, (error) => {
  if (error) {
    console.error(`Failed to start server on port ${env.PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
