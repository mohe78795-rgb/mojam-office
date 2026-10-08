require('dotenv').config();
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const uri = process.env.MONGODB_URI; const dbName = process.env.MONGODB_DB || 'mojam_office';
if (!uri) throw new Error('MONGODB_URI is required');
(async () => {
  const client = new MongoClient(uri); await client.connect(); const db = client.db(dbName);
  const employee_code = process.env.ADMIN_EMPLOYEE_CODE || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  const password_hash = await bcrypt.hash(password, 12);
  const user = { id: crypto.randomUUID(), account_id: 'mojam-main', employee_code, full_name: 'مدير النظام', password_hash, roles: ['owner','admin'], permissions: ['*'], status: 'active', failed_login_count: 0, created_at: new Date(), updated_at: new Date() };
  await db.collection('users').updateOne({ account_id: user.account_id, employee_code }, { $set: { ...user, password_hash, updated_at: new Date() }, $setOnInsert: { created_at: user.created_at } }, { upsert: true });
  console.log(`Admin ready: ${employee_code}`); await client.close();
})().catch(err => { console.error(err); process.exit(1); });
