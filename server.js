require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const required = ['SESSION_SECRET', 'ADMIN_PASSWORD'];
for (const key of required) if (!process.env[key]) {
  console.error(`Konfigurasi wajib belum diisi: ${key}`); process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET harus minimal 32 karakter.'); process.exit(1);
}
const app = express();
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 phone TEXT NOT NULL UNIQUE,
 consent INTEGER NOT NULL DEFAULT 0,
 consent_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 meta_name TEXT NOT NULL,
 language TEXT NOT NULL DEFAULT 'id',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER,
 description TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30kb', verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(session({
 secret: process.env.SESSION_SECRET,
 resave: false,
 saveUninitialized: false,
 cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const sendLimiter = rateLimit({ windowMs: 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
const requireLogin = (req, res, next) => req.session && req.session.authenticated ? next() : res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
const log = (customerId, description) => db.prepare('INSERT INTO activity(customer_id,description) VALUES(?,?)').run(customerId || null, description);

app.post('/api/login', loginLimiter, (req, res) => {
 const password = String(req.body?.password || '');
 const a = Buffer.from(password); const b = Buffer.from(process.env.ADMIN_PASSWORD);
 if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Kata sandi tidak cocok.' });
 req.session.authenticated = true;
 res.json({ ok: true });
});
app.post('/api/logout', requireLogin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'WA BUSINESS ANTI SPAM', cloudConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.META_GRAPH_VERSION) }));

app.get('/api/customers', requireLogin, (req, res) => res.json(db.prepare('SELECT * FROM customers ORDER BY id DESC').all()));
app.post('/api/customers', requireLogin, (req, res) => {
 const name = String(req.body?.name || '').trim();
 const phone = String(req.body?.phone || '').replace(/\D/g, '');
 const consent = req.body?.consent === true;
 if (!name || !/^62\d{8,15}$/.test(phone)) return res.status(400).json({ error: 'Nama atau format nomor tidak valid. Gunakan format 62...' });
 if (!consent) return res.status(400).json({ error: 'Persetujuan pelanggan wajib dicatat sebelum promosi.' });
 try {
  const info = db.prepare('INSERT INTO customers(name,phone,consent,consent_at) VALUES(?,?,1,?)').run(name, phone, new Date().toISOString());
  log(info.lastInsertRowid, 'Persetujuan promosi dicatat');
  res.status(201).json({ id: info.lastInsertRowid });
 } catch { res.status(409).json({ error: 'Nomor tersebut sudah terdaftar.' }); }
});
app.post('/api/customers/:id/optout', requireLogin, (req, res) => {
 const info = db.prepare('UPDATE customers SET consent=0 WHERE id=?').run(Number(req.params.id));
 if (!info.changes) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
 log(Number(req.params.id), 'STOP PROMOSI: persetujuan dinonaktifkan');
 res.json({ ok: true });
});
app.delete('/api/customers/:id', requireLogin, (req, res) => {
 const id = Number(req.params.id); db.prepare('DELETE FROM customers WHERE id=?').run(id); log(null, `Data pelanggan ${id} dihapus`); res.json({ ok: true });
});
app.get('/api/templates', requireLogin, (req, res) => res.json(db.prepare('SELECT * FROM templates ORDER BY id DESC').all()));
app.post('/api/templates', requireLogin, (req, res) => {
 const title = String(req.body?.title || '').trim();
 const metaName = String(req.body?.metaName || '').trim();
 const language = String(req.body?.language || 'id').trim();
 if (!title || !/^[a-z0-9_]{2,512}$/.test(metaName)) return res.status(400).json({ error: 'Nama template Meta harus berupa nama template yang disetujui, huruf kecil/angka/garis bawah.' });
 const info = db.prepare('INSERT INTO templates(title,meta_name,language) VALUES(?,?,?)').run(title, metaName, language);
 res.status(201).json({ id: info.lastInsertRowid });
});
app.delete('/api/templates/:id', requireLogin, (req, res) => { db.prepare('DELETE FROM templates WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); });
app.get('/api/activity', requireLogin, (req, res) => res.json(db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 100').all()));

// Mengirim satu template yang telah disetujui Meta kepada satu pelanggan yang masih opt-in.
app.post('/api/send-template', requireLogin, sendLimiter, async (req, res) => {
 const customerId = Number(req.body?.customerId); const templateId = Number(req.body?.templateId);
 const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
 const template = db.prepare('SELECT * FROM templates WHERE id=?').get(templateId);
 if (!customer || !customer.consent) return res.status(403).json({ error: 'Pelanggan tidak ditemukan atau sudah STOP PROMOSI.' });
 if (!template) return res.status(400).json({ error: 'Template tidak ditemukan.' });
 const version = process.env.META_GRAPH_VERSION;
 const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
 const token = process.env.WHATSAPP_ACCESS_TOKEN;
 if (!version || !phoneId || !token) return res.status(503).json({ error: 'Cloud API belum dikonfigurasi di server.' });
 try {
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
   method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: customer.phone, type: 'template', template: { name: template.meta_name, language: { code: template.language } } })
  });
  const result = await response.json();
  if (!response.ok) { log(customer.id, 'Pengiriman gagal: respons Meta'); return res.status(response.status).json({ error: 'Meta menolak permintaan. Periksa template, nomor, izin, dan konfigurasi di Meta.', details: result.error?.message || 'Kesalahan API' }); }
  log(customer.id, `Permintaan template ${template.meta_name} diterima API Meta`);
  res.json({ ok: true, message: 'Permintaan diterima API Meta.', messages: result.messages || [] });
 } catch (e) { log(customer.id, 'Pengiriman gagal: koneksi server'); res.status(502).json({ error: 'Server tidak dapat menghubungi Meta.' }); }
});

// Webhook verifikasi Meta. POST memeriksa tanda tangan app secret sebelum membaca payload.
app.get('/webhook', (req, res) => {
 const mode = req.query['hub.mode']; const token = req.query['hub.verify_token']; const challenge = req.query['hub.challenge'];
 if (mode === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(challenge));
 res.sendStatus(403);
});
app.post('/webhook', (req, res) => {
 const secret = process.env.WHATSAPP_APP_SECRET;
 if (!secret) return res.sendStatus(503);
 const signature = req.get('x-hub-signature-256') || '';
 const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
 const a = Buffer.from(signature); const b = Buffer.from(expected);
 if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
 // Terima webhook terverifikasi; pemrosesan rinci dapat ditambahkan setelah konfigurasi Meta.
 res.sendStatus(200);
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`WA BUSINESS ANTI SPAM berjalan pada port ${PORT}`));
