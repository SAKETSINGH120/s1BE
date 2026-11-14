import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';

beforeAll(async () => {
  const databaseUrl = new URL(inject('mongoUri'));
  databaseUrl.pathname = `/test-${crypto.randomUUID()}`;

  await connectDatabase(databaseUrl.toString());
  await mongoose.connection.syncIndexes();
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});
