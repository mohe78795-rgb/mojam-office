// شغّل هذا الملف من mongosh بعد اختيار قاعدة البيانات mojam_office
// mongosh "$MONGODB_URI/mojam_office" mongodb/init.js

const collections = [
  'accounts','users','roles','permissions','user_sessions','access_approvals','access_requests',
  'daily_sessions','product_categories','daily_prices','customers','suppliers',
  'shipment_cards','shipment_lines','shipment_expenses','invoices','invoice_items',
  'daily_expenses','stock_snapshots','returns','customer_ledger_entries',
  'crate_ledger_entries','sms_messages','conversations','conversation_messages',
  'ai_models','ai_provider_configs','ai_reply_requests','training_rules',
  'automation_settings','sync_queue','audit_logs','api_request_logs','attachments',
  'daily_closings','number_sequences','notifications','login_events','migration_maps'
];

for (const name of collections) {
  if (!db.getCollectionNames().includes(name)) db.createCollection(name);
}

const ix = (name, spec, options = {}) => db.getCollection(name).createIndex(spec, options);
ix('accounts', { id: 1 }, { unique: true });
ix('users', { account_id: 1, employee_code: 1 }, { unique: true });
ix('users', { account_id: 1, status: 1 });
ix('user_sessions', { token_hash: 1 }, { unique: true });
ix('user_sessions', { user_id: 1, revoked_at: 1 });
ix('daily_sessions', { account_id: 1, session_date: 1 }, { unique: true });
ix('customers', { account_id: 1, phone_normalized: 1 }, { unique: true, sparse: true });
ix('suppliers', { account_id: 1, name: 1 });
ix('shipment_cards', { account_id: 1, daily_session_id: 1, card_number: 1 }, { unique: true });
ix('shipment_lines', { shipment_card_id: 1, category_code: 1 });
ix('invoices', { account_id: 1, daily_session_id: 1, invoice_number: 1 }, { unique: true });
ix('invoices', { account_id: 1, invoice_date: 1 });
ix('invoice_items', { invoice_id: 1 });
ix('invoice_items', { supplier_card_id: 1, category_code: 1 });
ix('sms_messages', { account_id: 1, phone_normalized: 1, received_at: -1 });
ix('sms_messages', { account_id: 1, match_status: 1 });
ix('conversations', { account_id: 1, phone_normalized: 1 }, { unique: true });
ix('conversation_messages', { conversation_id: 1, created_at: 1 });
ix('ai_models', { account_id: 1, active: 1 });
ix('training_rules', { account_id: 1, active: 1, priority: -1 });
ix('sync_queue', { account_id: 1, status: 1, created_at: 1 });
ix('audit_logs', { account_id: 1, created_at: -1 });
ix('api_request_logs', { account_id: 1, created_at: -1 });

print('Mojam collections and indexes are ready.');
