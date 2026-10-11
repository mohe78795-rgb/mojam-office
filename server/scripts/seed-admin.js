const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'mojam_office';
const employeeCode = process.env.ADMIN_EMPLOYEE_CODE || 'admin';
const password = process.env.ADMIN_PASSWORD;

if (!uri) throw new Error('MONGO_URI or MONGODB_URI is required');
if (!password || password.length < 10) {
  throw new Error('ADMIN_PASSWORD must be at least 10 characters');
}

(async () => {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const accountId = 'mojam-main';
    const now = new Date();

    const existing = await db.collection('users').findOne({
      account_id: accountId,
      employee_code: employeeCode
    });

    const user = {
      id: existing?.id || crypto.randomUUID(),
      account_id: accountId,
      employee_code: employeeCode,
      full_name: 'مدير النظام',
      password_hash: await bcrypt.hash(password, 12),
      roles: ['owner', 'admin'],
      permissions: ['*'],
      status: 'active',
      failed_login_count: 0,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.collection('users').updateOne(
      { account_id: accountId, employee_code: employeeCode },
      { $set: user },
      { upsert: true }
    );

    console.log(`Admin ready: ${employeeCode}`);
  } finally {
    await client.close();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
