import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

// The binary mongodb-memory-server's postinstall downloaded into this project's node_modules.
const downloadDir = fileURLToPath(
  new URL('../node_modules/.cache/mongodb-memory-server', import.meta.url),
);

// One in-memory MongoDB for the whole run; each test file uses its own database on it.
export default async function setup({ provide }) {
  const mongoServer = await MongoMemoryServer.create({ binary: { downloadDir } });
  provide('mongoUri', mongoServer.getUri());

  return async () => {
    await mongoServer.stop();
  };
}
