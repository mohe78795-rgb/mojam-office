require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { MongoClient } = require('mongodb');
const { generateGeminiReply, extractOrderRequest } = require('./gemini');
const { buildBusinessContext } = require('./business-context');
const { reserveInvoiceNumber } = require('./invoice-numbering');

const PORT = Number(process.env.PORT || 10000);
const DB_NAME = process.env.MONGODB_DB || 'mojam_office';
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const ACCOUNT_ID = process.env.DEFAULT_ACCOUNT_ID || 'mojam-main';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const SMS_GATEWAY_TOKEN = process.env.SMS_GATEWAY_TOKEN || '';
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
      const tokenHash = hashToken(token);
      const session = await db.collection('user_sessions').findOne({ user_id: payload.sub, revoked_at: null, $or: [{ token_hash: tokenHash }, { background_access_hash: tokenHash }] });
      const user = await db.collection('users').findOne({ id: payload.sub, account_id: ACCOUNT_ID });
      if (user && ['blocked','left_company','rejected'].includes(user.status)) return res.status(403).json({ success: false, error: 'USER_BLOCKED', fullName: user.full_name, message: `عزيزي ${user.full_name || 'المستخدم'}، لقد تم حظرك من قبل المدير. شكرًا لك.` });
      if (!session || !user || user.status !== 'active' || (user.expires_at && new Date(user.expires_at) < now())) return res.status(401).json({ success: false, error: 'SESSION_REVOKED' });
      req.user = user; req.auth = payload;
      await db.collection('user_sessions').updateOne({ id: session.id }, { $set: { last_seen_at: now() } });
      next();
    } catch (e) { return res.status(401).json({ success: false, error: 'INVALID_TOKEN' }); }
  };
}
function admin(req, res, next) { if (!req.user || !(req.user.roles || []).some(r => ['admin','owner'].includes(r))) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' }); next(); }
function phoneGatewayAuth(req, res, next) {
  if (!SMS_GATEWAY_TOKEN) return res.status(503).json({ success: false, error: 'SMS_GATEWAY_NOT_CONFIGURED', message: 'أضف SMS_GATEWAY_TOKEN إلى متغيرات الخادم أولاً.' });
  const header = String(req.headers.authorization || '');
  const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(SMS_GATEWAY_TOKEN);
  if (!supplied.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ success: false, error: 'GATEWAY_UNAUTHORIZED' });
  }
  next();
}

async function storeSmsBatch(messages, source = 'android-phone-gateway') {
  const operations = [];
  for (const item of messages) {
    const rawPhone = String(item?.address || item?.number || item?.from || item?.phone || item?.phone_normalized || '').trim();
    const phone = normPhone(rawPhone);
    const body = String(item?.body || item?.message || '').trim().slice(0, 5000);
    if (!phone || !body) continue;
    const rawDate = item?.date || item?.received_at || item?.created_at || item?.received || '';
    let timeValue = typeof rawDate === 'number' ? rawDate : (/^\d{11,13}$/.test(String(rawDate)) ? Number(rawDate) : Date.parse(rawDate));
    if (!Number.isFinite(timeValue) || timeValue <= 0) timeValue = now().getTime();
    const createdAt = new Date(timeValue);
    const rawDirection = String(item?.direction || item?.type || '').toLowerCase();
    const type = Number(item?.type || 1);
    const direction = ['outbound','sent','out','outbox','2','4'].includes(rawDirection) || type === 2 || type === 4 ? 'outbound' : 'inbound';
    const externalKey = crypto.createHash('sha256').update(`${ACCOUNT_ID}\0${phone}\0${direction}\0${createdAt.getTime()}\0${body}`).digest('hex');
    const row = { id: externalKey, external_key: externalKey, account_id: ACCOUNT_ID, phone_normalized: phone, address: rawPhone || phone, number: rawPhone || phone, body, direction, type: direction === 'inbound' ? 1 : 2, date: createdAt, received_at: createdAt, created_at: createdAt, gateway_received_at: now(), source };
    operations.push({ row, update: { updateOne: { filter: { account_id: ACCOUNT_ID, external_key: externalKey }, update: { $setOnInsert: row }, upsert: true } } });
  }
  if (!operations.length) return { received: messages.length, accepted: 0, inserted: 0, insertedRows: [] };
  const result = await db.collection('sms_messages').bulkWrite(operations.map(item => item.update), { ordered: true });
  const ids = result.upsertedIds || {};
  const insertedIndexes = new Set(Object.keys(ids).map(Number));
  const insertedRows = operations.filter((_, index) => insertedIndexes.has(index)).map(item => item.row);
  return { received: messages.length, accepted: operations.length, inserted: result.upsertedCount || insertedRows.length, insertedRows };
}

async function processGatewayAutoReply(message) {
  const settings = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  if (!(settings?.autoGenerate ?? settings?.auto_generate) || !GEMINI_API_KEY) return { status: 'disabled' };
  const receivedAt = new Date(message.gateway_received_at || message.received_at || message.date || now());
  const enabledAt = settings.auto_generate_since ? new Date(settings.auto_generate_since) : null;
  if (enabledAt && receivedAt < enabledAt) return { status: 'before_enabled' };
  if (settings.allowedContactsOnly ?? settings.allowed_contacts_only) {
    const phones = settings.allowedPhones ?? settings.allowed_phones;
    const allowed = (Array.isArray(phones) ? phones : []).map(normPhone);
    if (!allowed.includes(normPhone(message.phone_normalized))) return { status: 'not_allowed' };
  }
  try {
    const context = await buildBusinessContext(db, ACCOUNT_ID, { phone: message.phone_normalized, message: message.body });
    const generated = await generateGeminiReply({
      message: message.body,
      name: context.customerName || 'العميل',
      dialect: settings.dialect || 'yemeni_neutral',
      responseFormat: settings.responseFormat || 'مختصر',
      responseRules: settings.responseRules || '',
      responseNumbers: Array.isArray(settings.responseNumbers) ? settings.responseNumbers : [],
      trustedContext: context.text
    }, { apiKey: GEMINI_API_KEY, modelId: GEMINI_MODEL });
    const sendAutomatically = Boolean(settings.autoSend ?? settings.auto_send);
    const gatewayReady = Boolean(SMS_GATEWAY_TOKEN);
    const reply = {
      id: id(), account_id: ACCOUNT_ID, phone_normalized: message.phone_normalized,
      direction: 'outbound', body: generated.reply, message: generated.reply,
      source: 'zoe-server-automation', model: generated.model,
      reply_to: message.external_key, sim_slot_index: Number(settings.simSlotIndex ?? settings.sim_slot_index) || 0, created_at: now(),
      send_status: sendAutomatically ? (gatewayReady ? 'queued' : 'failed') : 'draft',
      error_message: sendAutomatically && !gatewayReady ? 'SMS_GATEWAY_NOT_CONFIGURED' : null
    };
    await db.collection('conversation_messages').insertOne(reply);
    await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: message.external_key }, { $set: { auto_reply_status: reply.send_status, auto_reply_id: reply.id } });
    return { status: reply.send_status };
  } catch (error) {
    console.error('[SMS GATEWAY] automatic reply failed:', { code: error.code || 'AUTO_REPLY_FAILED' });
    await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: message.external_key }, { $set: { auto_reply_status: 'error', auto_reply_error: error.code || 'AUTO_REPLY_FAILED' } });
    return { status: 'error' };
  }
}

app.get('/api/health', async (req, res) => {
  try { await db.command({ ping: 1 }); res.json({ success: true, status: 'ok', database: 'connected', time: now().toISOString() }); }
  catch { res.status(503).json({ success: false, status: 'degraded', database: 'disconnected' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const code = String(req.body.employeeCode || '').trim();
  const phone = normPhone(req.body.phone || '');
  const fullName = String(req.body.fullName || '').trim();
  const password = String(req.body.password || '');
  const user = code ? await db.collection('users').findOne({ account_id: ACCOUNT_ID, employee_code: code }) : await db.collection('users').findOne({ account_id: ACCOUNT_ID, phone_normalized: phone, full_name: fullName });
  if (user && ['blocked','left_company','rejected'].includes(user.status)) return res.status(403).json({ success: false, error: 'USER_BLOCKED', fullName: user.full_name, message: `عزيزي ${user.full_name || 'المستخدم'}، لقد تم حظرك من قبل المدير. شكرًا لك.` });
  if (!user || !password || !(await bcrypt.compare(password, user.password_hash)) || user.status !== 'active') return res.status(401).json({ success: false, error: 'INVALID_LOGIN' });
  const token = jwt.sign({ sub: user.id, accountId: ACCOUNT_ID, roles: user.roles || [] }, JWT_SECRET, { expiresIn: '30m' });
  const backgroundToken = crypto.randomBytes(32).toString('hex');
  await db.collection('user_sessions').insertOne({ id: id(), user_id: user.id, account_id: ACCOUNT_ID, token_hash: hashToken(token), background_token_hash: hashToken(backgroundToken), background_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), device_id: req.body.deviceId || null, created_at: now(), last_seen_at: now(), expires_at: new Date(Date.now() + 30 * 60 * 1000), revoked_at: null });
  await db.collection('users').updateOne({ id: user.id }, { $set: { last_login_at: now(), failed_login_count: 0 } });
  res.json({ success: true, accessToken: token, backgroundToken, user: publicUser(user) });
});
app.post('/api/auth/background-token', auth(), async (req, res) => {
  const currentToken = String(req.headers.authorization || '').slice(7);
  const currentHash = hashToken(currentToken);
  const session = await db.collection('user_sessions').findOne({ user_id: req.user.id, revoked_at: null, $or: [{ token_hash: currentHash }, { background_access_hash: currentHash }] });
  if (!session) return res.status(401).json({ success: false, error: 'SESSION_REVOKED' });
  const backgroundToken = crypto.randomBytes(32).toString('hex');
  await db.collection('user_sessions').updateOne({ id: session.id, revoked_at: null }, { $set: { background_token_hash: hashToken(backgroundToken), background_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } });
  res.json({ success: true, backgroundToken });
});
app.post('/api/auth/background-refresh', async (req, res) => {
  const backgroundToken = String(req.body?.backgroundToken || '');
  if (!/^[a-f0-9]{64}$/.test(backgroundToken)) return res.status(401).json({ success: false, error: 'BACKGROUND_TOKEN_INVALID' });
  const session = await db.collection('user_sessions').findOne({ background_token_hash: hashToken(backgroundToken), revoked_at: null, background_expires_at: { $gt: now() } });
  if (!session) return res.status(401).json({ success: false, error: 'BACKGROUND_SESSION_EXPIRED' });
  const user = await db.collection('users').findOne({ id: session.user_id, account_id: ACCOUNT_ID, status: 'active' });
  if (!user) return res.status(403).json({ success: false, error: 'USER_BLOCKED' });
  const accessToken = jwt.sign({ sub: user.id, accountId: ACCOUNT_ID, roles: user.roles || [] }, JWT_SECRET, { expiresIn: '30m' });
  await db.collection('user_sessions').updateOne({ id: session.id, revoked_at: null }, { $set: { background_access_hash: hashToken(accessToken), background_access_expires_at: new Date(Date.now() + 30 * 60 * 1000), last_background_seen_at: now() } });
  res.json({ success: true, accessToken });
});
app.post('/api/auth/logout', auth(), async (req, res) => { const token = req.headers.authorization.slice(7); await db.collection('user_sessions').updateOne({ token_hash: hashToken(token) }, { $set: { revoked_at: now(), revoke_reason: 'logout' } }); res.json({ success: true }); });
app.get('/api/auth/me', auth(), (req, res) => res.json({ success: true, user: publicUser(req.user) }));

app.post('/api/auth/request-access', async (req, res) => {
  const full_name = String(req.body.fullName || '').trim();
  const phone = String(req.body.phone || '').trim();
  const employee_code = String(req.body.employeeCode || ('EMP-' + normPhone(phone)).trim()).trim();
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
  const requestId = String(req.body.requestId || '').trim(); const code = String(req.body.approvalCode || '').trim();
  const request = await db.collection('access_requests').findOne({ id: requestId, status: 'pending' });
  if (!request || new Date(request.expires_at) < now() || !(await bcrypt.compare(code, request.code_hash))) return res.status(400).json({ success: false, error: 'INVALID_OR_EXPIRED_APPROVAL_CODE' });
  await db.collection('users').updateOne({ id: request.user_id }, { $set: { status: 'active', approved_at: now(), updated_at: now() } });
  await db.collection('access_requests').updateOne({ id: requestId }, { $set: { status: 'approved', approved_at: now() } });
  res.json({ success: true, message: 'تم تفعيل الحساب. يمكنك تسجيل الدخول الآن.' });
});
app.get('/api/auth/request-status', async (req, res) => {
  const requestId = String(req.query.requestId || '').trim();
  if (!requestId) return res.status(400).json({ success: false, error: 'REQUEST_ID_REQUIRED' });
  const request = await db.collection('access_requests').findOne({ id: requestId, account_id: ACCOUNT_ID });
  if (!request) return res.status(404).json({ success: false, error: 'REQUEST_NOT_FOUND' });
  const user = await db.collection('users').findOne({ id: request.user_id, account_id: ACCOUNT_ID }, { projection: { status: 1 } });
  if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  let status = 'pending';
  if (['blocked', 'left_company', 'rejected'].includes(user.status)) status = 'rejected';
  else if (user.status === 'active') status = 'approved';
  else if (['rejected', 'revoked'].includes(request.status)) status = 'rejected';
  else if (request.status === 'approved') status = 'approved';
  res.json({ success: true, status });
});
app.get('/api/admin/users', auth(), admin, async (req, res) => {
  const users = await db.collection('users').find({ account_id: ACCOUNT_ID }).project({ password_hash: 0 }).sort({ created_at: -1 }).toArray();
  res.json({ success: true, data: users });
});
app.post('/api/admin/users/:id/issue-code', auth(), admin, async (req, res) => {
  const user = await db.collection('users').findOne({ id: req.params.id, account_id: ACCOUNT_ID });
  if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  const code = String(crypto.randomInt(100000, 999999)); const requestId = id();
  await db.collection('access_requests').updateMany({ user_id: user.id, status: 'pending' }, { $set: { status: 'revoked', revoked_at: now() } });
  await db.collection('access_requests').insertOne({ id: requestId, user_id: user.id, account_id: ACCOUNT_ID, phone: user.phone, full_name: user.full_name, code_hash: await bcrypt.hash(code, 12), status: 'pending', expires_at: new Date(Date.now() + 24*60*60*1000), created_at: now(), issued_by: req.user.id });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'access.code_issued', entity_type: 'user', entity_id: user.id, created_at: now(), created_by: req.user.id });
  res.json({ success: true, requestId, approvalCode: code, note: 'يظهر الرمز مرة واحدة للمدير، أرسله للعامل يدويًا.' });
});
app.post('/api/admin/users/:id/reject', auth(), admin, async (req, res) => {
  const reason = String(req.body.reason || 'تم رفض طلب الانضمام').trim();
  const result = await db.collection('users').updateOne({ id: req.params.id, account_id: ACCOUNT_ID }, { $set: { status: 'rejected', rejection_reason: reason, rejected_by: req.user.id, rejected_at: now(), updated_at: now() } });
  await db.collection('access_requests').updateMany({ user_id: req.params.id, status: 'pending' }, { $set: { status: 'rejected', rejected_at: now(), rejection_reason: reason } });
  if (!result.matchedCount) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'user.rejected', entity_type: 'user', entity_id: req.params.id, created_at: now(), created_by: req.user.id });
  res.json({ success: true, message: 'تم رفض طلب المستخدم.' });
});
app.post('/api/admin/users/:id/approve', auth(), admin, async (req, res) => {
  const approvedAt = now();
  const result = await db.collection('users').updateOne({ id: req.params.id, account_id: ACCOUNT_ID }, { $set: { status: 'active', approved_by: req.user.id, approved_at: approvedAt, updated_at: approvedAt } });
  if (!result.matchedCount) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  await db.collection('access_requests').updateMany({ user_id: req.params.id, account_id: ACCOUNT_ID, status: 'pending' }, { $set: { status: 'approved', approved_by: req.user.id, approved_at: approvedAt } });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'user.approved', entity_type: 'user', entity_id: req.params.id, created_at: approvedAt, created_by: req.user.id });
  res.json({ success: true, status: 'approved' });
});
app.put('/api/admin/users/:id/access', auth(), admin, async (req, res) => {
  const allowedRoles = ['sales','accountant','shipment_receiver','message_operator','report_viewer','admin'];
  const allowedPermissions = ['invoices.view','invoices.create','invoices.edit','shipments.view','shipments.create','shipments.edit','customers.view','customers.edit','sms.read','sms.generate_reply','sms.send','reports.export'];
  const role = allowedRoles.includes(req.body.role) ? req.body.role : 'sales';
  const permissions = Array.isArray(req.body.permissions) ? [...new Set(req.body.permissions.filter(x => allowedPermissions.includes(x)))] : [];
  const result = await db.collection('users').updateOne({ id: req.params.id, account_id: ACCOUNT_ID }, { $set: { roles: [role], permissions, updated_at: now(), access_updated_by: req.user.id } });
  if (!result.matchedCount) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  await db.collection('audit_logs').insertOne({ id: id(), account_id: ACCOUNT_ID, action: 'user.access_updated', entity_type: 'user', entity_id: req.params.id, after_data: { role, permissions }, created_at: now(), created_by: req.user.id });
  res.json({ success: true, role, permissions });
});
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
  const name = String(req.body.name || '').trim(); const phone = String(req.body.phone || '').trim();
  if (!name || !phone) return res.status(400).json({ success: false, error: 'NAME_AND_PHONE_REQUIRED' });
  const doc = { id: id(), account_id: ACCOUNT_ID, name, phone, phone_normalized: normPhone(phone), total_delivered: Number(req.body.total_delivered || 0), total_returned: Number(req.body.total_returned || 0), updated_at: now(), created_at: now() };
  const { created_at, ...customerUpdate } = doc; await db.collection('customers').updateOne({ account_id: ACCOUNT_ID, phone_normalized: doc.phone_normalized }, { $set: customerUpdate, $setOnInsert: { created_at } }, { upsert: true });
  res.status(201).json({ success: true, data: doc });
});

app.get('/api/ai/models', (req, res) => {
  const knownNames = { 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite', 'gemini-3.5-flash': 'Gemini 3.5 Flash' };
  const models = [{ id: GEMINI_MODEL, name: knownNames[GEMINI_MODEL] || GEMINI_MODEL, provider: 'Google Gemini', active: true }];
  res.json({ success: true, models, data: models, defaultModel: GEMINI_MODEL, configured: Boolean(GEMINI_API_KEY) });
});
app.post('/api/invoices/next-number', auth(), async (req, res) => {
  try {
    const reservation = await reserveInvoiceNumber(db, ACCOUNT_ID, req.user, now());
    return res.json({ success: true, ...reservation });
  } catch (error) {
    console.error('[INVOICE] number reservation failed:', { code: error.code || error.message || 'INVOICE_NUMBER_UNAVAILABLE' });
    return res.status(503).json({ success: false, error: 'INVOICE_NUMBER_UNAVAILABLE', message: 'تعذر حجز رقم فاتورة فريد الآن. تحقق من الاتصال ثم أعد المحاولة.' });
  }
});
app.get('/api/automation', auth(), async (req, res) => {
  const stored = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  const data = stored || { account_id: ACCOUNT_ID, auto_generate: false, auto_send: false, local_fallback: true };
  const serverAutomationActive = Boolean(GEMINI_API_KEY && (stored?.autoGenerate ?? stored?.auto_generate));
  res.json({ success: true, configured: Boolean(stored), gatewayReady: Boolean(SMS_GATEWAY_TOKEN), serverAutomationActive, data });
});
app.put('/api/automation', auth(), admin, async (req, res) => {
  const allowed = ['allowedContactsOnly','allowedPhones','autoGenerate','autoSend','localFallback','refreshSeconds','simSlotIndex','model','dialect','responseFormat','responseRules','responseNumbers'];
  const previous = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  const data = { account_id: ACCOUNT_ID, updated_at: now() };
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) data[key] = req.body[key];
  if (typeof req.body?.autoSend === 'boolean') {
    data.auto_send = req.body.autoSend;
    if (req.body.autoSend) data.auto_send_pause_reason = null;
  }
  const nextAutoGenerate = data.autoGenerate ?? previous?.autoGenerate ?? previous?.auto_generate ?? false;
  const nextAutoSend = data.autoSend ?? previous?.autoSend ?? previous?.auto_send ?? false;
  const previousAutoGenerate = previous?.autoGenerate ?? previous?.auto_generate ?? false;
  if (nextAutoGenerate && (!previousAutoGenerate || !previous?.auto_generate_since)) data.auto_generate_since = now();
  await db.collection('automation_settings').updateOne({ account_id: ACCOUNT_ID }, { $set: data }, { upsert: true });
  if (!nextAutoSend) {
    await db.collection('conversation_messages').updateMany(
      { account_id: ACCOUNT_ID, send_status: 'queued', source: 'zoe-native-background' },
      { $set: { send_status: 'draft', error_message: 'AUTO_SEND_DISABLED', updated_at: now() } }
    );
  }
  const saved = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  res.json({ success: true, configured: true, gatewayReady: Boolean(SMS_GATEWAY_TOKEN), serverAutomationActive: Boolean(GEMINI_API_KEY && nextAutoGenerate), data: saved });
});

async function createNativeFallbackReply(inbound, settings, errorCode, customerName = 'العميل') {
  const fallbackEnabled = (settings?.localFallback ?? settings?.local_fallback) !== false;
  if (!fallbackEnabled) return null;
  const safeName = String(customerName || 'العميل').replace(/[\r\n]+/g, ' ').slice(0, 80);
  const fallbackText = `حياك الله ${safeName}، وصلت رسالتك وسنرد عليك قريبًا. مكتب معجم لتسويق الدواجن.`;
  const shouldSend = Boolean(settings?.autoSend ?? settings?.auto_send);
  const reply = {
    id: id(), account_id: ACCOUNT_ID, phone_normalized: inbound.phone_normalized,
    direction: 'outbound', body: fallbackText, message: fallbackText,
    source: 'zoe-native-background', model: 'local-fallback', reply_to: inbound.external_key,
    sim_slot_index: Number(settings.simSlotIndex ?? settings.sim_slot_index) || 0,
    created_at: now(), send_status: shouldSend ? 'sending' : 'draft',
    claimed_at: shouldSend ? now() : null, native_device_id: shouldSend ? 'android-java-direct' : null,
    fallback_reason: String(errorCode || 'GEMINI_FAILED').slice(0, 120)
  };
  await db.collection('conversation_messages').insertOne(reply);
  await db.collection('sms_messages').updateOne(
    { account_id: ACCOUNT_ID, external_key: inbound.external_key },
    { $set: { auto_reply_status: reply.send_status, auto_reply_id: reply.id, auto_reply_fallback: true, auto_reply_error: reply.fallback_reason } }
  );
  return {
    replyId: reply.id, queued: false, draft: !shouldSend,
    dispatch: shouldSend ? { id: reply.id, phone_normalized: reply.phone_normalized, body: reply.body, sim_slot_index: reply.sim_slot_index } : null
  };
}

// Android SMS_RECEIVED events are processed by the cloud; the Android app remains the SMS transport.
app.post('/api/sms/native/inbound', auth(), async (req, res) => {
  const phone = String(req.body?.phone || req.body?.address || '').trim();
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  const date = Number(req.body?.timestamp) || Date.now();
  if (!phone || !body) return res.status(400).json({ success: false, error: 'PHONE_AND_BODY_REQUIRED' });
  const normalizedPhone = normPhone(phone);
  if (!normalizedPhone) return res.status(400).json({ success: false, error: 'INVALID_PHONE' });
  let settings = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  if (!(settings?.autoGenerate ?? settings?.auto_generate)) return res.json({ success: true, generated: false, reason: 'AUTO_GENERATE_DISABLED' });
  const stored = await storeSmsBatch([{ phone, body, date, direction: 'inbound' }], 'android-native-background');
  const externalKey = crypto.createHash('sha256').update(`${ACCOUNT_ID}\0${normalizedPhone}\0inbound\0${date}\0${body}`).digest('hex');
  const existing = stored.insertedRows[0] || await db.collection('sms_messages').findOne({ account_id: ACCOUNT_ID, external_key: externalKey });
  if (!existing) return res.json({ success: true, duplicate: true, generated: false });
  const claimResult = await db.collection('sms_messages').findOneAndUpdate(
    { account_id: ACCOUNT_ID, external_key: existing.external_key, auto_reply_status: null },
    { $set: { auto_reply_status: 'processing', auto_reply_started_at: now(), auto_reply_source: 'android-native-background' } },
    { returnDocument: 'after' }
  );
  const inbound = claimResult?.value || claimResult || null;
  if (!inbound || inbound.auto_reply_status !== 'processing') return res.json({ success: true, duplicate: true, generated: false, reason: 'ALREADY_PROCESSED_OR_IN_PROGRESS' });
  const receivedAt = new Date(inbound.received_at || inbound.date || now());
  const enabledAt = settings.auto_generate_since ? new Date(settings.auto_generate_since) : null;
  if (enabledAt && receivedAt < enabledAt) {
    await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: inbound.external_key }, { $set: { auto_reply_status: 'skipped', auto_reply_error: 'BEFORE_AUTOMATION_ENABLED' } });
    return res.json({ success: true, generated: false, reason: 'BEFORE_AUTOMATION_ENABLED' });
  }
  if (settings.allowedContactsOnly ?? settings.allowed_contacts_only) {
    const allowed = (Array.isArray(settings.allowedPhones ?? settings.allowed_phones) ? (settings.allowedPhones ?? settings.allowed_phones) : []).map(normPhone);
    if (!allowed.includes(normPhone(inbound.phone_normalized))) {
      await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: inbound.external_key }, { $set: { auto_reply_status: 'skipped', auto_reply_error: 'CONTACT_NOT_ALLOWED' } });
      return res.json({ success: true, generated: false, reason: 'CONTACT_NOT_ALLOWED' });
    }
  }
  if (!GEMINI_API_KEY) {
    const fallback = await createNativeFallbackReply(inbound, settings, 'AI_PROVIDER_NOT_CONFIGURED');
    if (fallback) return res.json({ success: true, generated: false, fallback: true, ...fallback });
    await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: inbound.external_key }, { $set: { auto_reply_status: 'error', auto_reply_error: 'AI_PROVIDER_NOT_CONFIGURED' } });
    return res.status(503).json({ success: false, error: 'AI_PROVIDER_NOT_CONFIGURED' });
  }
  let customerName = 'العميل';
  try {
    const context = await buildBusinessContext(db, ACCOUNT_ID, { phone: inbound.phone_normalized, message: inbound.body });
    customerName = context.customerName || 'العميل';
    const generated = await generateGeminiReply({
      message: inbound.body,
      name: customerName,
      dialect: settings.dialect || 'yemeni_neutral',
      responseFormat: settings.responseFormat || 'مختصر',
      responseRules: settings.responseRules || '',
      responseNumbers: Array.isArray(settings.responseNumbers) ? settings.responseNumbers : [],
      trustedContext: context.text
    }, { apiKey: GEMINI_API_KEY, modelId: GEMINI_MODEL });
    const shouldSend = Boolean(settings.autoSend ?? settings.auto_send);
    const reply = { id: id(), account_id: ACCOUNT_ID, phone_normalized: inbound.phone_normalized, direction: 'outbound', body: generated.reply, message: generated.reply, source: 'zoe-native-background', model: generated.model, reply_to: inbound.external_key, sim_slot_index: Number(settings.simSlotIndex ?? settings.sim_slot_index) || 0, created_at: now(), send_status: shouldSend ? 'sending' : 'draft', claimed_at: shouldSend ? now() : null, native_device_id: shouldSend ? 'android-java-direct' : null };
    await db.collection('conversation_messages').insertOne(reply);
    await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: inbound.external_key }, { $set: { auto_reply_status: reply.send_status, auto_reply_id: reply.id } });
    return res.json({ success: true, generated: true, queued: false, draft: !shouldSend, replyId: reply.id, dispatch: shouldSend ? { id: reply.id, phone_normalized: reply.phone_normalized, body: reply.body, sim_slot_index: reply.sim_slot_index } : null });
  } catch (error) {
    const errorCode = error.code || 'AUTO_REPLY_FAILED';
    console.error('[SMS NATIVE] automatic generation failed:', { code: errorCode });
    if (Number(error.status) === 429) {
      settings = { ...settings, autoSend: false, auto_send: false };
      await db.collection('automation_settings').updateOne({ account_id: ACCOUNT_ID }, { $set: { autoSend: false, auto_send: false, updated_at: now(), auto_send_pause_reason: 'GEMINI_QUOTA_429' } });
      await db.collection('conversation_messages').updateMany(
        { account_id: ACCOUNT_ID, send_status: 'queued', source: 'zoe-native-background' },
        { $set: { send_status: 'draft', error_message: 'GEMINI_QUOTA_429', updated_at: now() } }
      );
    }
    const fallback = await createNativeFallbackReply(inbound, settings, errorCode, customerName);
    if (fallback) return res.json({ success: true, generated: false, fallback: true, ...fallback });
    await db.collection('sms_messages').updateOne({ account_id: ACCOUNT_ID, external_key: inbound.external_key }, { $set: { auto_reply_status: 'error', auto_reply_error: errorCode } });
    return res.status(502).json({ success: false, error: errorCode });
  }
});
app.get('/api/sms/native/outbox/next', auth(), async (req, res) => {
  // Fail closed for older APKs: never drain a global queue into the handset.
  await db.collection('conversation_messages').updateMany(
    { account_id: ACCOUNT_ID, send_status: 'queued', source: 'zoe-native-background' },
    { $set: { send_status: 'draft', error_message: 'LEGACY_GLOBAL_QUEUE_DISABLED', updated_at: now() } }
  );
  res.json({ success: true, message: null, error: 'LEGACY_GLOBAL_QUEUE_DISABLED' });
});
app.post('/api/sms/native/outbox/:id/result', auth(), async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!['submitted', 'failed'].includes(status)) return res.status(400).json({ success: false, error: 'INVALID_SEND_STATUS' });
  const update = { send_status: status, gateway_result_at: now(), gateway_result: String(req.body?.detail || '').slice(0, 500) };
  if (status === 'submitted') update.submitted_at = now();
  else update.error_message = String(req.body?.error || 'SMS_SEND_FAILED').slice(0, 500);
  const result = await db.collection('conversation_messages').updateOne({ account_id: ACCOUNT_ID, id: req.params.id, source: 'zoe-native-background', send_status: 'sending' }, { $set: update });
  res.json({ success: true, updated: result.modifiedCount === 1 });
});

app.get('/api/sms/messages', auth(), async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 1000));
  const messages = await db.collection('sms_messages').find({ account_id: ACCOUNT_ID }).sort({ received_at: -1 }).limit(limit).toArray();
  res.json({ success: true, messages, data: messages });
});
app.post('/api/sms/sync', auth(), async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (messages.length > 500) return res.status(413).json({ success: false, error: 'SMS_SYNC_BATCH_TOO_LARGE', message: 'أرسل الرسائل على دفعات لا تتجاوز 500 رسالة.' });
  const result = await storeSmsBatch(messages, 'android-app-sync');
  res.json({ success: true, received: result.received, accepted: result.accepted, inserted: result.inserted });
});
app.post('/api/sms/gateway/inbound', phoneGatewayAuth, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.json({ success: true, received: 0, accepted: 0, inserted: 0, generated: 0 });
  if (messages.length > 200) return res.status(413).json({ success: false, error: 'SMS_SYNC_BATCH_TOO_LARGE', message: 'أرسل دفعات لا تتجاوز 200 رسالة.' });
  const result = await storeSmsBatch(messages, 'android-phone-gateway');
  const settings = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  let autoSince = settings?.auto_generate_since ? new Date(settings.auto_generate_since) : null;
  if ((settings?.autoGenerate ?? settings?.auto_generate) && !autoSince) {
    autoSince = now();
    await db.collection('automation_settings').updateOne({ account_id: ACCOUNT_ID }, { $set: { auto_generate_since: autoSince } });
  }
  const eligible = (settings?.autoGenerate ?? settings?.auto_generate) && GEMINI_API_KEY
    ? result.insertedRows.filter(row => row.direction === 'inbound' && (!autoSince || new Date(row.received_at) >= autoSince))
    : [];
  const processed = [];
  for (let offset = 0; offset < eligible.length; offset += 3) {
    processed.push(...await Promise.all(eligible.slice(offset, offset + 3).map(row => processGatewayAutoReply(row))));
  }
  res.json({ success: true, received: result.received, accepted: result.accepted, inserted: result.inserted, autoReplyEligible: eligible.length, autoReplyProcessed: processed.length, autoReplyStatuses: processed.map(item => item.status) });
});
app.get('/api/sms/gateway/outbox/next', phoneGatewayAuth, async (req, res) => {
  const deviceId = String(req.query.deviceId || 'android-phone').slice(0, 100);
  const staleBefore = new Date(Date.now() - 3 * 60 * 1000);
  const result = await db.collection('conversation_messages').findOneAndUpdate(
    { account_id: ACCOUNT_ID, $or: [{ send_status: 'queued' }, { send_status: 'sending', claimed_at: { $lt: staleBefore } }] },
    { $set: { send_status: 'sending', claimed_at: now(), gateway_device_id: deviceId } },
    { sort: { created_at: 1 }, returnDocument: 'after' }
  );
  const message = result?.value || result || null;
  res.json({ success: true, message: message && message.send_status === 'sending' ? message : null });
});
app.post('/api/sms/gateway/outbox/:id/result', phoneGatewayAuth, async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!['sent','failed'].includes(status)) return res.status(400).json({ success: false, error: 'INVALID_SEND_STATUS' });
  const update = { send_status: status, gateway_result_at: now(), gateway_result: String(req.body?.detail || '').slice(0, 500) };
  if (status === 'sent') update.sent_at = now();
  else update.error_message = String(req.body?.error || 'SMS_SEND_FAILED').slice(0, 500);
  const result = await db.collection('conversation_messages').updateOne({ account_id: ACCOUNT_ID, id: req.params.id, send_status: 'sending' }, { $set: update });
  res.json({ success: true, updated: result.modifiedCount === 1 });
});
app.post('/api/sms/send', auth(), async (req, res) => {
  const phone = normPhone(req.body.phone); const message = String(req.body.message || '').trim().slice(0, 5000);
  if (!phone || !message) return res.status(400).json({ success: false, error: 'PHONE_AND_MESSAGE_REQUIRED' });
  if (!SMS_GATEWAY_TOKEN) return res.status(503).json({ success: false, error: 'SMS_GATEWAY_NOT_CONFIGURED', message: 'بوابة الهاتف غير متصلة. أضف SMS_GATEWAY_TOKEN وشغّل بوابة Termux.' });
  const row = { id: id(), account_id: ACCOUNT_ID, phone_normalized: phone, body: message, message, direction: 'outbound', sim_slot_index: Math.max(0, Number(req.body.simSlotIndex) || 0), send_status: 'queued', created_at: now() };
  await db.collection('conversation_messages').insertOne(row);
  res.status(202).json({ success: true, queued: true, archived: true, message: 'أُضيفت الرسالة إلى طابور هاتف SMS.', data: row });
});
app.get('/api/conversations/:phone', auth(), async (req, res) => {
  const phone = normPhone(req.params.phone);
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 1000, 5000));
  const [smsRows, conversationRows] = await Promise.all([
    db.collection('sms_messages').find({ account_id: ACCOUNT_ID, phone_normalized: phone }).sort({ received_at: 1 }).limit(limit).toArray(),
    db.collection('conversation_messages').find({ account_id: ACCOUNT_ID, phone_normalized: phone }).sort({ created_at: 1 }).limit(limit).toArray()
  ]);
  const merged = [...smsRows, ...conversationRows].map(row => {
    const body = String(row.body || row.message || row.reply || '');
    const direction = row.direction || (Number(row.type) === 2 || Number(row.type) === 4 ? 'outbound' : 'inbound');
    const createdAt = row.created_at || row.received_at || row.date || row.createdAt || now();
    return { ...row, message: body, body, direction, created_at: createdAt, createdAt };
  }).filter(row => row.message);
  const unique = new Map();
  for (const row of merged) {
    const time = new Date(row.created_at).getTime() || 0;
    const key = row.external_key || `${row.direction}\0${time}\0${row.message}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  const conversations = [...unique.values()].sort((a, b) => (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0));
  res.json({ success: true, conversations, data: conversations });
});
app.post('/api/conversations', auth(), async (req, res) => {
  const phone = normPhone(req.body.phone || req.body.phone_normalized);
  const message = String(req.body.message || req.body.body || '').trim().slice(0, 5000);
  if (!phone || !message) return res.status(400).json({ success: false, error: 'PHONE_AND_MESSAGE_REQUIRED' });
  const row = { ...req.body, id: id(), account_id: ACCOUNT_ID, phone_normalized: phone, body: message, message, created_at: now() };
  await db.collection('conversation_messages').insertOne(row);
  res.status(201).json({ success: true, data: row });
});

app.get('/api/sync/day', async (req, res) => { const row = await db.collection('daily_sessions').findOne({ account_id: ACCOUNT_ID, session_date: String(req.query.date) }); res.json({ success: true, data: row?.payload || {} }); });
app.put('/api/sync/day', async (req, res) => { const date = String(req.body.date || req.query.date || '').slice(0, 10); if (!date) return res.status(400).json({ success: false, error: 'DATE_REQUIRED' }); const row = { id: `${ACCOUNT_ID}_${date}`, account_id: ACCOUNT_ID, session_date: date, status: 'open', payload: req.body, updated_at: now() }; await db.collection('daily_sessions').updateOne({ id: row.id }, { $set: row, $setOnInsert: { created_at: now() } }, { upsert: true }); res.json({ success: true, data: row }); });
app.post('/api/chat', auth(), async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'MESSAGE_REQUIRED', message: 'اكتب رسالة العميل أولاً.' });
  if (message.length > 5000) return res.status(413).json({ success: false, error: 'MESSAGE_TOO_LONG', message: 'الرسالة أطول من الحد المسموح به.' });
  if (req.body.model && req.body.model !== GEMINI_MODEL) {
    return res.status(400).json({ success: false, error: 'UNSUPPORTED_MODEL', message: `النموذج المضبوط على الخادم هو ${GEMINI_MODEL}.` });
  }
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ success: false, error: 'AI_PROVIDER_NOT_CONFIGURED', message: 'لم يُضف مفتاح Gemini إلى متغيرات الخادم بعد. أضف GEMINI_API_KEY في Render ثم أعد النشر.' });
  }
  try {
    let businessContext;
    try {
      businessContext = await buildBusinessContext(db, ACCOUNT_ID, { phone: req.body.phone, message });
    } catch (contextError) {
      console.error('[AI] MongoDB context lookup failed:', { code: contextError.code || 'BUSINESS_CONTEXT_LOOKUP_FAILED' });
      businessContext = { text: 'تعذر جلب حقائق قاعدة البيانات لهذا الطلب؛ لا تخمّن أي سعر أو مخزون أو رصيد.', customerName: '', customerLookupAttempted: false };
    }
    const generated = await generateGeminiReply({
      message,
      name: businessContext.customerName || (businessContext.customerLookupAttempted ? 'العميل' : req.body.name),
      dialect: req.body.dialect,
      responseFormat: req.body.responseFormat,
      responseRules: req.body.responseRules,
      responseNumbers: req.body.responseNumbers,
      trustedContext: businessContext.text
    }, { apiKey: GEMINI_API_KEY, modelId: GEMINI_MODEL });
    return res.json({ success: true, reply: generated.reply, model: generated.model, provider: 'google-gemini', fallback: false, contextDate: businessContext.date || null, usage: generated.usage });
  } catch (error) {
    const providerStatus = Number(error.status) || 502;
    console.error('[AI] Gemini request failed:', { status: providerStatus, code: error.code || 'GEMINI_UPSTREAM_ERROR' });
    if (providerStatus === 429) {
      await db.collection('automation_settings').updateOne({ account_id: ACCOUNT_ID }, { $set: { autoSend: false, auto_send: false, auto_send_pause_reason: 'GEMINI_QUOTA_429', updated_at: now() } });
      await db.collection('conversation_messages').updateMany(
        { account_id: ACCOUNT_ID, send_status: 'queued', source: 'zoe-native-background' },
        { $set: { send_status: 'draft', error_message: 'GEMINI_QUOTA_429', updated_at: now() } }
      );
    }
    let message = 'تعذر الاتصال بنموذج Gemini. حاول مرة أخرى لاحقًا.';
    if (providerStatus === 400) message = 'رفض Gemini صيغة الطلب. تحقق من الرسالة والإعدادات ثم أعد المحاولة.';
    else if (providerStatus === 401 || providerStatus === 403) message = 'مفتاح Gemini غير صالح أو غير مخوّل للمشروع. راجع GEMINI_API_KEY وقيود المفتاح في Google AI Studio.';
    else if (providerStatus === 404) message = `لم يتعرف Gemini على النموذج ${GEMINI_MODEL}. تحقق من GEMINI_MODEL وإتاحة النموذج للمشروع.`;
    else if (providerStatus === 429) message = 'تم تجاوز حصة Gemini أو حد الطلبات. تحقق من الحصة في Google AI Studio ثم أعد المحاولة.';
    else if (error.code === 'GEMINI_TIMEOUT') message = 'انتهت مهلة الاتصال بـGemini. حاول مرة أخرى.';
    else if (error.code === 'GEMINI_NETWORK_ERROR') message = 'تعذر الوصول إلى Gemini من الخادم. تحقق من اتصال Render ثم أعد المحاولة.';
    const httpStatus = providerStatus === 429 ? 429 : providerStatus === 503 ? 503 : 502;
    return res.status(httpStatus).json({ success: false, error: error.code || 'GEMINI_UPSTREAM_ERROR', message, providerStatus });
  }
});

app.post('/api/orders/drafts', auth(), async (req, res) => {
  const phone = normPhone(req.body?.phone);
  const message = String(req.body?.message || '').trim().slice(0, 5000);
  const sourceMessageId = String(req.body?.sourceMessageId || '').trim().slice(0, 200);
  if (!phone || !message) return res.status(400).json({ success: false, error: 'PHONE_AND_MESSAGE_REQUIRED' });
  if (!GEMINI_API_KEY) return res.status(503).json({ success: false, error: 'AI_PROVIDER_NOT_CONFIGURED', message: 'Gemini غير مضبوط على الخادم.' });

  const sourceKey = sourceMessageId
    ? crypto.createHash('sha256').update(`${ACCOUNT_ID}\0${phone}\0${sourceMessageId}`).digest('hex')
    : id();
  if (sourceMessageId) {
    const existing = await db.collection('order_drafts').findOne({ account_id: ACCOUNT_ID, source_key: sourceKey });
    if (existing) return res.json({ success: true, orderDetected: true, duplicate: true, draft: existing });
  }

  try {
    const parsed = await extractOrderRequest(message, { apiKey: GEMINI_API_KEY, modelId: GEMINI_MODEL });
    const result = parsed.order || {};
    const intent = ['order', 'inquiry', 'other', 'unclear'].includes(String(result.intent || '').toLowerCase())
      ? String(result.intent).toLowerCase() : 'unclear';
    const question = String(result.clarificationQuestion || '').trim().slice(0, 500);
    if (intent === 'inquiry' || intent === 'other' || (intent === 'unclear' && !question && !(Array.isArray(result.items) && result.items.length))) {
      return res.json({ success: true, orderDetected: false, intent, draft: null });
    }

    const categories = new Set(['كبير', 'وسط', 'مطاعم', 'جفش', 'صغير']);
    const items = (Array.isArray(result.items) ? result.items : []).slice(0, 10).map(item => {
      let category = String(item?.category || '').trim();
      if (category === 'جفوش') category = 'جفش';
      if (!categories.has(category)) category = 'غير محدد';
      const rawUnit = String(item?.unit || '').trim();
      const unit = /شبك/.test(rawUnit) ? 'شبك' : /حب[ةه]|حبات/.test(rawUnit) ? 'بالحبة' : 'غير محدد';
      const quantityNumber = Number(item?.quantity);
      const quantity = Number.isFinite(quantityNumber) && quantityNumber > 0 ? Math.min(quantityNumber, 1000000) : 0;
      return { category, quantity, unit };
    });
    const needsClarification = intent !== 'order' || !items.length || items.some(item => !item.quantity || item.category === 'غير محدد' || item.unit === 'غير محدد');
    const customer = await db.collection('customers').findOne({ account_id: ACCOUNT_ID, phone_normalized: phone }, { projection: { name: 1, full_name: 1 } });
    const draft = {
      id: id(), account_id: ACCOUNT_ID, phone_normalized: phone,
      customer_name: String(customer?.name || customer?.full_name || '').slice(0, 100),
      source_message_id: sourceMessageId || null, source_key: sourceKey,
      original_message: message, intent, items,
      note: String(result.note || '').trim().slice(0, 500),
      clarification_question: needsClarification ? (question || 'ما الصنف والكمية؟ وهل الطلب بالشبك أم بالحبة؟') : '',
      confidence: Math.min(1, Math.max(0, Number(result.confidence) || 0)),
      model: parsed.model, status: needsClarification ? 'needs_clarification' : 'draft',
      created_by: req.user.id, created_at: now(), updated_at: now()
    };
    await db.collection('order_drafts').insertOne(draft);
    return res.status(201).json({ success: true, orderDetected: true, draft });
  } catch (error) {
    if (error?.code === 11000 && sourceMessageId) {
      const existing = await db.collection('order_drafts').findOne({ account_id: ACCOUNT_ID, source_key: sourceKey });
      if (existing) return res.json({ success: true, orderDetected: true, duplicate: true, draft: existing });
    }
    const status = Number(error.status) || 502;
    console.error('[ORDERS] draft extraction failed:', { status, code: error.code || 'ORDER_EXTRACTION_FAILED' });
    const httpStatus = status === 429 ? 429 : status === 503 ? 503 : 502;
    return res.status(httpStatus).json({ success: false, error: error.code || 'ORDER_EXTRACTION_FAILED', message: 'تعذر تحليل الطلب الآن؛ لم يُحفظ أي حجز.' });
  }
});

app.get('/api/orders/drafts', auth(), async (req, res) => {
  const status = String(req.query.status || 'open');
  const openStatuses = ['draft', 'needs_clarification'];
  if (!['open', 'all', ...openStatuses].includes(status)) return res.status(400).json({ success: false, error: 'INVALID_DRAFT_STATUS' });
  const filter = { account_id: ACCOUNT_ID };
  if (status === 'open') filter.status = { $in: openStatuses };
  else if (status !== 'all') filter.status = status;
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
  const drafts = await db.collection('order_drafts').find(filter).sort({ created_at: -1 }).limit(limit).toArray();
  res.json({ success: true, drafts, data: drafts });
});

app.get('/api/admin/overview', auth(), admin, async (req, res) => {
  const names = ['users','access_requests','customers','suppliers','shipment_cards','invoices','sms_messages','order_drafts','audit_logs'];
  const counts = {}; for (const name of names) counts[name] = await db.collection(name).countDocuments({ account_id: ACCOUNT_ID });
  res.json({ success: true, accountId: ACCOUNT_ID, database: DB_NAME, counts, generatedAt: now() });
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../../public/admin.html')));
app.use(express.static(path.join(__dirname, '../../public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));

async function start() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI or MONGO_URI is required');
  mongo = new MongoClient(MONGODB_URI); await mongo.connect(); db = mongo.db(DB_NAME);
  await db.collection('sms_messages').createIndex({ account_id: 1, external_key: 1 }, { unique: true, partialFilterExpression: { external_key: { $type: 'string' } }, name: 'sms_external_key_unique' });
  await db.collection('sms_messages').createIndex({ account_id: 1, phone_normalized: 1, received_at: 1 }, { name: 'sms_conversation_history' });
  await db.collection('conversation_messages').createIndex({ account_id: 1, phone_normalized: 1, created_at: 1 }, { name: 'conversation_history' });
  await db.collection('order_drafts').createIndex({ account_id: 1, source_key: 1 }, { unique: true, partialFilterExpression: { source_key: { $type: 'string' } }, name: 'order_draft_source_unique' });
  await db.collection('order_drafts').createIndex({ account_id: 1, status: 1, created_at: -1 }, { name: 'order_draft_review_queue' });
  const automation = await db.collection('automation_settings').findOne({ account_id: ACCOUNT_ID });
  if (automation && !automation.native_sms_queue_hotfix_applied_at) {
    await db.collection('automation_settings').updateOne({ account_id: ACCOUNT_ID }, { $set: {
      autoSend: false, auto_send: false, native_sms_queue_hotfix_applied_at: now(),
      auto_send_pause_reason: 'NATIVE_SMS_QUEUE_SAFETY_HOTFIX', updated_at: now()
    } });
  }
  await db.collection('conversation_messages').updateMany(
    { account_id: ACCOUNT_ID, send_status: 'queued', source: 'zoe-native-background' },
    { $set: { send_status: 'draft', error_message: 'NATIVE_QUEUE_HOTFIX_REVIEW_REQUIRED', updated_at: now() } }
  );
  await ensureBaseData();
  app.listen(PORT, '0.0.0.0', () => console.log(`Mojam server listening on ${PORT}`));
}
start().catch(err => { console.error(err); process.exit(1); });
