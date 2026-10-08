require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { MongoClient } = require('mongodb');

const PORT = Number(process.env.PORT || 10000);
const DB_NAME = process.env.MONGODB_DB || 'mojam_office';
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const ACCOUNT_ID = 'mojam-main';
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',').map(x => x.trim()) : true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

let db;
let mongo;
const now = () => new Date();
const id = () => crypto.randomUUID();
const normPhone = value => {
  const raw = String(value || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('967') && digits.length >= 12) digits = digits.slice(-9);
  return digits.slice(-9);
};
const publicUser = u => ({ id: u.id, employeeCode: u.employee_code, name: u.full_name, status: u.status, roles: u.roles || [], permissions: u.permissions || [] });
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

async function ensureBaseData() {
  await db.collection('accounts').updateOne({ id: ACCOUNT_ID }, { $setOnInsert: { id: ACCOUNT_ID, name: 'مكتب معجم', currency: 'YER', timezone: 'Asia/Aden', created_at: now(), updated_at: now() } }, { upsert: true });
  await db.collection('product_categories').bulkWrite([
    ['كبير','kabeer',1], ['وسط','wasat',2], ['مطاعم','restaurants',3], ['جفوش','jafsh',4], ['صغير','small',5]
  ].map(([name_ar, code, sort_order]) => ({ updateOne: { filter: { code }, update: { $setOnInsert: { code, name_ar, sort_order, active: true } }, upsert: true } })));
}

function auth(required = true) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) { if (!required) return next(); return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' }); }
      const payload = jwt.verify(token, JWT_SECRET);
      const session = await db.collection('user_sessions').findOne({ token_hash: hashToken(token), user_id: payload.sub, revoked_at: null });
      const user = await db.collection('users').findOne({ id: payload.sub, account_id: ACCOUNT_ID });
      if (!session || !user || user.status !== 'active' || (user.expires_at && new Date(user.expires_at) < now())) return res.status(401).json({ success: false, error: 'SESSION_REVOKED' });
      req.user = user; req.auth = payload;
      await db.collection('user_sessions').updateOne({ id: session.id }, { $set: { last_seen_at: now() } });
      next();
    } catch (e) { return res.status(401).json({ success: false, error: 'INVALID_TOKEN' }); }
  };
}
function admin(req, res, next) { if (!req.user || !(req.user.roles || []).some(r => ['admin','owner'].includes(r))) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' }); next(); }

app.get('/api/health', async (req, res) => {
  try { await db.command({ ping: 1 }); res.json({ success: true, status: 'ok', database: 'connected', time: now().toISOString() }); }
  catch { res.status(503).json({ success: false, status: 'degraded', database: 'disconnected' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const code = String(req.body.employeeCode || '').trim();
  const password = String(req.body.password || '');
  const user = await db.collection('users').findOne({ account_id: ACCOUNT_ID, employee_code: code });
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ success: false, error: 'INVALID_LOGIN' });
  const token = jwt.sign({ sub: user.id, accountId: ACCOUNT_ID, roles: user.roles || [] }, JWT_SECRET, { expiresIn: '30m' });
  await db.collection('user_sessions').insertOne({ id: id(), user_id: user.id, account_id: ACCOUNT_ID, token_hash: hashToken(token), device_id: req.body.deviceId || null, created_at: now(), last_seen_at: now(), expires_at: new Date(Date.now() + 30 * 60 * 1000), revoked_at: null });
  await db.collection('users').updateOne({ id: user.id }, { $set: { last_login_at: now(), failed_login_count: 0 } });
  res.json({ success: true, accessToken: token, user: publicUser(user) });
});
app.post('/api/auth/logout', auth(), async (req, res) => { const token = req.headers.authorization.slice(7); await db.collection('user_sessions').updateOne({ token_hash: hashToken(token) }, { $set: { revoked_at: now(), revoke_reason: 'logout' } }); res.json({ success: true }); });
app.get('/api/auth/me', auth(), (req, res) => res.json({ success: true, user: publicUser(req.user) }));

app.post('/api/auth/request-access', async (req, res) => {
  const full_name = String(req.body.fullName || '').trim();
  const phone = String(req.body.phone || '').trim();
  const employee_code = String(req.body.employeeCode || '').trim();
  const password = String(req.body.password || '');
  if (!full_name || !phone || !employee_code || password.length < 8) return res.status(400).json({ success: false, error: 'NAME_PHONE_CODE_PASSWORD_REQUIRED' });
  const exists = await db.collection('users').findOne({ account_id: ACCOUNT_ID, employee_code });
  if (exists && ['active','pending'].includes(exists.status)) return res.status(409).json({ success: false, error: 'EMPLOYEE_CODE_EXISTS' });
  const userId = exists?.id || id();
  const requestId = id();
  const activationCode = String(crypto.randomInt(100000, 999999));
  const password_hash = await bcrypt.hash(password, 12);
  const row = { id: userId, account_id: ACCOUNT_ID, employee_code, full_name, phone, phone_normalized: normPhone(phone), password_hash, roles: ['sales'], permissions: ['invoices.view','invoices.create'], status: 'pending', failed_login_count: 0, created_at: exists?.created_at || now(), updated_at: now(), access_request_id: requestId };
  await db.collection('users').updateOne({ id: userId }, { $set: row }, { upsert: true });
  await db.collection('access_requests').insertOne({ id: requestId, user_id: userId, account_id: ACCOUNT_ID, phone, full_name, code_hash: await bcrypt.hash(activationCode, 12), status: 'pending', expires_at: new Date(Date.now() + 24*60*60*1000), created_at: now() });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'access.requested', entity_type: 'user', entity_id: userId, after_data: { full_name, phone, employee_code }, created_at: now() });
  res.status(201).json({ success: true, requestId, message: 'تم إرسال طلبك إلى الإدارة. اطلب من المدير تزويدك برمز الموافقة يدويًا.' });
});
app.post('/api/auth/activate', async (req, res) => {
  const requestId = String(req.body.requestId || '').trim(); 
  const code = String(req.body.approvalCode || '').trim();
  const request = await db.collection('access_requests').findOne({ id: requestId, status: 'pending' });
  if (!request || new Date(request.expires_at) < now() || !(await bcrypt.compare(code, request.code_hash))) return res.status(400).json({ success: false, error: 'INVALID_OR_EXPIRED_APPROVAL_CODE' });
  await db.collection('users').updateOne({ id: request.user_id }, { $set: { status: 'active', approved_at: now(), updated_at: now() } });
  await db.collection('access_requests').updateOne({ id: requestId }, { $set: { status: 'approved', approved_at: now() } });
  res.json({ success: true, message: 'تم تفعيل الحساب. يمكنك تسجيل الدخول الآن.' });
});
app.get('/api/admin/users', auth(), admin, async (req, res) => {
  const users = await db.collection('users').find({ account_id: ACCOUNT_ID }).project({ password_hash: 0 }).sort({ created_at: -1 }).toArray();
  res.json({ success: true, data: users });
});
app.post('/api/admin/users/:id/issue-code', auth(), admin, async (req, res) => {
  const user = await db.collection('users').findOne({ id: req.params.id, account_id: ACCOUNT_ID });
  if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  const code = String(crypto.randomInt(100000, 999999)); 
  const requestId = id();
  await db.collection('access_requests').updateMany({ user_id: user.id, status: 'pending' }, { $set: { status: 'revoked', revoked_at: now() } });
  await db.collection('access_requests').insertOne({ id: requestId, user_id: user.id, account_id: ACCOUNT_ID, phone: user.phone, full_name: user.full_name, code_hash: await bcrypt.hash(code, 12), status: 'pending', expires_at: new Date(Date.now() + 24*60*60*1000), created_at: now(), issued_by: req.user.id });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'access.code_issued', entity_type: 'user', entity_id: user.id, created_at: now(), created_by: req.user.id });
  res.json({ success: true, requestId, approvalCode: code, note: 'يظهر الرمز مرة واحدة للمدير، أرسله للعامل يدويًا.' });
});
app.post('/api/admin/users/:id/approve', auth(), admin, async (req, res) => { await db.collection('users').updateOne({ id: req.params.id, account_id: ACCOUNT_ID }, { $set: { status: 'active', approved_by: req.user.id, approved_at: now(), updated_at: now() } }); res.json({ success: true }); });
app.post('/api/admin/users/:id/block', auth(), admin, async (req, res) => {
  await db.collection('users').updateOne({ id: req.params.id, account_id: ACCOUNT_ID }, { $set: { status: 'blocked', blocked_reason: req.body.reason || 'حظر إداري', updated_at: now() } });
  await db.collection('user_sessions').updateMany({ user_id: req.params.id, revoked_at: null }, { $set: { revoked_at: now(), revoke_reason: 'admin_block' } });
  await db.collection('access_requests').updateMany({ user_id: req.params.id, status: 'pending' }, { $set: { status: 'revoked', revoked_at: now() } });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'user.blocked', entity_type: 'user', entity_id: req.params.id, created_at: now(), created_by: req.user.id });
  res.json({ success: true, message: 'تم حظر المستخدم وإلغاء جلساته.' });
});
app.post('/api/admin/users/:id/unblock', auth(), admin, async (req, res) => { await db.collection('users').updateOne({ id: req.params.id, account_id: ACCOUNT_ID }, { $set: { status: 'active', blocked_reason: null, updated_at: now() } }); await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'user.unblocked', entity_type: 'user', entity_id: req.params.id, created_at: now(), created_by: req.user.id }); res.json({ success: true, message: 'تم رفع الحظر. يجب تسجيل الدخول من جديد.' }); });
app.post('/api/admin/users/:id/revoke-sessions', auth(), admin, async (req, res) => { await db.collection('user_sessions').updateMany({ user_id: req.params.id, revoked_at: null }, { $set: { revoked_at: now(), revoke_reason: 'admin_revoke' } }); res.json({ success: true }); });

app.get('/api/zoe', async (req, res) => res.json({ success: true, data: await db.collection('customers').find({ account_id: ACCOUNT_ID }).sort({ name: 1 }).limit(500).toArray() }));
app.post('/api/zoe', async (req, res) => {
  const name = String(req.body.name || '').trim(); 
  const phone = String(req.body.phone || '').trim();
  if (!name || !phone) return res.status(400).json({ success: false, error: 'NAME_AND_PHONE_REQUIRED' });
  const doc = { id: id(), account_id: ACCOUNT_ID, name, phone, phone_normalized: normPhone(phone), total_delivered: Number(req.body.total_delivered || 0), total_returned: Number(req.body.total_returned || 0), updated_at: now(), created_at: now() };
  const { created_at, ...customerUpdate } = doc; 
  await db.collection('customers').updateOne({ account_id: ACCOUNT_ID, phone_normalized: doc.phone_normalized }, { $set: customerUpdate,$setOnInsert: { created_at } }, { upsert: true });
  res.status(201).json({ success: true, data: doc });
});

app.get('/api/ai/models', async (req, res) => res.json({ success: true, data: await db.collection('ai_models').find({ account_id: ACCOUNT_ID, active: true }).toArray() }));
app.get('/api/automation', async (req, res) => res.json({ success: true, data: await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID }) || { account_id: ACCOUNT_ID, auto_generate: false, auto_send: false, local_fallback: true } }));
app.put('/api/automation', auth(), admin, async (req, res) => { const data = { ...req.body, account_id: ACCOUNT_ID, updated_at: now() }; await db.collection('automation_settings').updateOne({ account_id: ACCOUNT_ID }, { $set: data }, { upsert: true }); res.json({ success: true, data }); });

app.get('/api/sms/messages', async (req, res) => res.json({ success: true, data: await db.collection('sms_messages').find({ account_id: ACCOUNT_ID }).sort({ received_at: -1 }).limit(Number(req.query.limit || 100)).toArray() }));
app.post('/api/sms/send', auth(), async (req, res) => {
  const phone = normPhone(req.body.phone); 
  const message = String(req.body.message || '').trim();
  if (!phone || !message) return res.status(400).json({ success: false, error: 'PHONE_AND_MESSAGE_REQUIRED' });
  const row = { id: id(), account_id: ACCOUNT_ID, phone_normalized: phone, body: message, direction: 'outbound', send_status: process.env.SMS_PROVIDER_URL ? 'queued' : 'failed', error_message: process.env.SMS_PROVIDER_URL ? null : 'SMS_PROVIDER_NOT_CONFIGURED', created_at: now() };
  await db.collection('conversation_messages').insertOne(row);
  res.status(process.env.SMS_PROVIDER_URL ? 202 : 503).json({ success: Boolean(process.env.SMS_PROVIDER_URL), data: row, error: row.error_message });
});
app.get('/api/conversations/:phone', async (req, res) => res.json({ success: true, data: await db.collection('conversation_messages').find({ account_id: ACCOUNT_ID, phone_normalized: normPhone(req.params.phone) }).sort({ created_at: 1 }).limit(Number(req.query.limit || 50)).toArray() }));
app.post('/api/conversations', async (req, res) => { const row = { ...req.body, id: id(), account_id: ACCOUNT_ID, phone_normalized: normPhone(req.body.phone || req.body.phone_normalized), created_at: now() }; await db.collection('conversation_messages').insertOne(row); res.status(201).json({ success: true, data: row }); });

app.get('/api/sync/day', async (req, res) => { const row = await db.collection('daily_sessions').findOne({ account_id: ACCOUNT_ID, session_date: String(req.query.date) }); res.json({ success: true, data: row?.payload || {} }); });
app.put('/api/sync/day', async (req, res) => { const date = String(req.body.date || req.query.date || '').slice(0, 10); if (!date) return res.status(400).json({ success: false, error: 'DATE_REQUIRED' }); const row = { id: `${ACCOUNT_ID}_${date}`, account_id: ACCOUNT_ID, session_date: date, status: 'open', payload: req.body, updated_at: now() }; await db.collection('daily_sessions').updateOne({ id: row.id }, { $set: row,$setOnInsert: { created_at: now() } }, { upsert: true }); res.json({ success: true, data: row }); });
app.post('/api/chat', auth(false), async (req, res) => { res.json({ success: true, reply: `حياك الله ${req.body.name || ''}، وصلت رسالتك وسنرد عليك قريبًا. مكتب معجم لتسويق الدواجن.`, model: req.body.model || 'local-fallback', fallback: true }); });

app.use(express.static(path.join(__dirname, '../../public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));

async function start() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI or MONGO_URI is required');
  mongo = new MongoClient(mongoUri); 
  await mongo.connect(); 
  db = mongo.db(DB_NAME); 
  await ensureBaseData();                                
  app.listen(PORT, '0.0.0.0', () => console.log(`Mojam server listening on ${PORT}`));
}
start().catch(err => { console.error(err); process.exit(1); });
