// ============================================================
//  lib/db.js — MongoDB connection (cached across warm invocations)
// ============================================================
const { MongoClient } = require('mongodb');

let clientPromise = global._lunaMongo;

function getClient() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI environment variable is not set.');
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });
    clientPromise = global._lunaMongo = client.connect();
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || 'lunas_pos');
}

/** Auto-increment integer ids, so the frontend keeps seeing numeric `id`s. */
async function nextId(db, name, count = 1) {
  const r = await db.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = (r && r.value !== undefined ? r.value : r).seq; // driver v5/v6 compat
  return seq - count + 1; // first id of the reserved block
}

module.exports = { getDb, nextId };
