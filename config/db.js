const mongoose = require('mongoose');
const User = require('../models/User');

const isNamespaceMissingError = (error) =>
  error &&
  (
    error.codeName === 'NamespaceNotFound' ||
    error.code === 26 ||
    String(error.message || '').includes('ns does not exist')
  );

const collectionExists = async (collectionName) => {
  const collections = await mongoose.connection.db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();

  return collections.length > 0;
};

const removeLegacyUserIndexes = async () => {
  if (!(await collectionExists(User.collection.name))) {
    return;
  }

  const indexes = await User.collection.indexes();
  const legacyIndexNames = indexes
    .filter((index) => index.unique && !index.name.startsWith('_id_'))
    .filter((index) => {
      const keys = Object.keys(index.key || {});
      return (
        (keys.length === 1 && keys[0] === 'email') ||
        (keys.length === 1 && keys[0] === 'phone')
      );
    })
    .map((index) => index.name);

  for (const indexName of legacyIndexNames) {
    await User.collection.dropIndex(indexName);
    console.log(`Dropped legacy user index: ${indexName}`);
  }
};

const ensureUserCollection = async () => {
  if (await collectionExists(User.collection.name)) {
    return;
  }

  // Create the collection on first run so index inspection does not fail.
  try {
    await User.createCollection();
  } catch (error) {
    if (!String(error.message || '').includes('already exists')) {
      throw error;
    }
  }
};

const syncUserIndexes = async () => {
  try {
    await removeLegacyUserIndexes();
    await User.syncIndexes();
  } catch (error) {
    if (!isNamespaceMissingError(error)) {
      throw error;
    }

    await ensureUserCollection();
    await User.createIndexes();
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    await ensureUserCollection();
    await syncUserIndexes();

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Database: ${conn.connection.name}`);
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
