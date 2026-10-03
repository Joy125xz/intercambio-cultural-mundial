const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const { Resend } = require('resend');

const app = express();
const port = Number(process.env.PORT || 3000);
const notifyEmail = process.env.NOTIFICATION_EMAIL;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));

const attempts = new Map();
app.use('/api/applications', (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const record = attempts.get(ip);
  if (!record || now - record.startedAt > 60 * 60 * 1000) {
    attempts.set(ip, { startedAt: now, count: 1 });
    return next();
  }
  if (record.count >= 8) return res.status(429).json({ error: 'Has enviado varias solicitudes. Espera un rato e inténtalo de nuevo.' });
  record.count += 1;
  next();
});

const clean = (value, max = 600) => String(value || '').trim().slice(0, max);
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id UUID PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      age SMALLINT NOT NULL CHECK (age BETWEEN 13 AND 35),
      email VARCHAR(254) NOT NULL,
      country VARCHAR(80) NOT NULL,
      languages VARCHAR(100) NOT NULL DEFAULT '',
      participation_format VARCHAR(60) NOT NULL DEFAULT '',
      interest TEXT NOT NULL,
      learning_goals TEXT NOT NULL DEFAULT '',
      consent BOOLEAN NOT NULL CHECK (consent = TRUE),
      notification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/applications', async (req, res) => {
  const body = req.body || {};
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId || '') ? body.submissionId : crypto.randomUUID();
  const application = {
    name: clean(body.name, 100),
    age: Number(body.age),
    email: clean(body.email, 254).toLowerCase(),
    country: clean(body.country, 80),
    languages: clean(body.language, 100),
    format: clean(body.format, 60),
    interest: clean(body.interest),
    goals: clean(body.learn),
    consent: body.consent === true || body.consent === 'true'
  };
  if (!application.name || !Number.isInteger(application.age) || application.age < 13 || application.age > 35 || !application.country || !application.interest || !application.consent || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) {
    return res.status(400).json({ error: 'Revisa los campos obligatorios, la edad, el consentimiento y el correo electrónico.' });
  }
  if (!notifyEmail || !process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
    return res.status(503).json({ error: 'El servicio de correo todavía no está configurado.' });
  }
  try {
    const inserted = await pool.query(`
      INSERT INTO applications (id, name, age, email, country, languages, participation_format, interest, learning_goals, consent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO NOTHING RETURNING id
    `, [id, application.name, application.age, application.email, application.country, application.languages, application.format, application.interest, application.goals, application.consent]);
    if (!inserted.rowCount) {
      const existing = await pool.query('SELECT notification_status FROM applications WHERE id = $1', [id]);
      if (existing.rows[0]?.notification_status === 'sent') return res.status(200).json({ ok: true });
    }
    const lines = [
      'Nueva postulación — Intercambio Cultural Mundial',
      '', `Nombre: ${application.name}`, `Edad: ${application.age}`,
      `Correo: ${application.email}`, `País: ${application.country}`,
      `Idiomas: ${application.languages || 'No indicado'}`,
      `Formato: ${application.format || 'No indicado'}`, '',
      'Lo que quiere compartir:', application.interest, '',
      'Lo que espera aprender:', application.goals || 'No indicado', '',
      'Consentimiento recibido: sí'
    ].join('\n');
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: [notifyEmail],
      replyTo: application.email,
      subject: `Nueva postulación de ${application.name} — ICM`,
      text: lines,
      html: `<h2>Nueva postulación — Intercambio Cultural Mundial</h2><dl><dt>Nombre</dt><dd>${escapeHtml(application.name)}</dd><dt>Edad</dt><dd>${application.age}</dd><dt>Correo</dt><dd>${escapeHtml(application.email)}</dd><dt>País</dt><dd>${escapeHtml(application.country)}</dd><dt>Idiomas</dt><dd>${escapeHtml(application.languages || 'No indicado')}</dd><dt>Formato</dt><dd>${escapeHtml(application.format || 'No indicado')}</dd></dl><h3>Lo que quiere compartir</h3><p>${escapeHtml(application.interest).replace(/\n/g, '<br>')}</p><h3>Lo que espera aprender</h3><p>${escapeHtml(application.goals || 'No indicado').replace(/\n/g, '<br>')}</p><p>Consentimiento recibido: sí</p>`
    });
    if (error) throw new Error(error.message || 'No se pudo enviar la notificación.');
    await pool.query("UPDATE applications SET notification_status = 'sent' WHERE id = $1", [id]);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Application submission failed:', error.message);
    res.status(503).json({ error: 'No pudimos guardar o notificar tu solicitud. Inténtalo de nuevo en unos minutos.' });
  }
});

app.use(express.static(__dirname, { extensions: ['html'] }));

initializeDatabase().then(() => app.listen(port, () => console.log(`ICM server listening on ${port}`))).catch(error => {
  console.error('Database initialization failed:', error.message);
  process.exit(1);
});

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });

