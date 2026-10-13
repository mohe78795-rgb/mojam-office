#!/usr/bin/env node
'use strict';

// Mojam SMS gateway for a personal Android phone running Termux + Termux:API.
// Put a private .env file beside this script. Do not commit that file.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const BASE_URL = String(process.env.MOJAM_SERVER_URL || 'https://mojam-office.onrender.com').replace(/\/+$/, '');
const TOKEN = String(process.env.SMS_GATEWAY_TOKEN || '').trim();
const POLL_SECONDS = Math.max(10, Math.min(300, Number(process.env.POLL_SECONDS) || 15));
const FALLBACK_SIM_SLOT = Math.max(0, Number(process.env.SIM_SLOT) || 0);
const DEVICE_ID = String(process.env.GATEWAY_DEVICE_ID || 'mojam-termux-phone').slice(0, 100);
const SMS_LIMIT = Math.max(20, Math.min(500, Number(process.env.SMS_LIST_LIMIT) || 200));
let stopping = false;

if (!TOKEN) {
  console.error('Missing SMS_GATEWAY_TOKEN in server/scripts/.env');
  process.exit(2);
}

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function api(route, options = {}) {
  const response = await fetch(`${BASE_URL}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || `HTTP_${response.status}`);
  }
  return data;
}

function readSmsInbox() {
  const output = execFileSync('termux-sms-list', ['-d', '-n', '-t', 'inbox', '-l', String(SMS_LIMIT)], { encoding: 'utf8', timeout: 30000 });
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : (parsed.messages || parsed.data || []);
  return rows.filter(row => {
    const type = String(row.type || row.direction || '').toLowerCase();
    return !['sent', 'outbound', 'out', 'outbox', '2', '4'].includes(type);
  }).map(row => ({
    address: row.address || row.number || row.from || row.phone || '',
    body: row.body || row.message || '',
    date: row.date || row.received_at || row.created_at || '',
    direction: 'inbound',
    type: 'inbox'
  })).filter(row => row.address && row.body);
}

async function syncInbox() {
  const messages = readSmsInbox();
  if (!messages.length) return;
  const result = await api('/api/sms/gateway/inbound', {
    method: 'POST',
    body: JSON.stringify({ messages })
  });
  if (result.inserted || result.autoReplyProcessed) {
    log(`inbound archived=${result.inserted || 0}, auto-replies=${result.autoReplyProcessed || 0}`);
  }
}

function toYemenE164(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('967') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 9 && digits.startsWith('7')) return `+967${digits}`;
  if (digits.length === 10 && digits.startsWith('07')) return `+967${digits.slice(1)}`;
  return raw;
}

function sendWithSim(phone, text, slot) {
  const args = ['-n', toYemenE164(phone)];
  if (Number.isInteger(slot) && slot >= 0) args.push('-s', String(slot));
  args.push(String(text));
  const result = spawnSync('termux-sms-send', args, { encoding: 'utf8', timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `exit_${result.status}`).trim());
}

async function drainOutbox() {
  for (let count = 0; count < 20 && !stopping; count++) {
    const result = await api(`/api/sms/gateway/outbox/next?deviceId=${encodeURIComponent(DEVICE_ID)}`);
    const message = result.message;
    if (!message) return;
    try {
      const slot = Number.isInteger(Number(message.sim_slot_index)) ? Number(message.sim_slot_index) : FALLBACK_SIM_SLOT;
      sendWithSim(message.phone_normalized || message.phone || message.number, message.body || message.message, slot);
      await api(`/api/sms/gateway/outbox/${encodeURIComponent(message.id)}/result`, {
        method: 'POST', body: JSON.stringify({ status: 'sent', detail: 'Android accepted the SMS send request' })
      });
      log(`sent message ${message.id} via SIM slot ${slot}`);
    } catch (error) {
      try {
        await api(`/api/sms/gateway/outbox/${encodeURIComponent(message.id)}/result`, {
          method: 'POST', body: JSON.stringify({ status: 'failed', error: String(error.message || error).slice(0, 400) })
        });
      } catch (ackError) {
        log(`could not acknowledge failed send: ${ackError.message}`);
      }
      log(`send failed for message ${message.id}: ${error.message || error}`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  log(`Mojam phone gateway started; server=${BASE_URL}; interval=${POLL_SECONDS}s; device=${DEVICE_ID}`);
  try { execFileSync('termux-wake-lock', [], { stdio: 'ignore', timeout: 5000 }); } catch (_) {}
  while (!stopping) {
    try {
      await syncInbox();
      await drainOutbox();
    } catch (error) {
      log(`gateway check failed: ${error.message || error}`);
    }
    await sleep(POLL_SECONDS * 1000);
  }
  try { execFileSync('termux-wake-unlock', [], { stdio: 'ignore', timeout: 5000 }); } catch (_) {}
  log('Mojam phone gateway stopped.');
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
main().catch(error => { log(`fatal: ${error.message || error}`); process.exit(1); });
