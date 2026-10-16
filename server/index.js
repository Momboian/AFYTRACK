import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getStore } from './store.js';
import { authenticate } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { workRoutes, runReminders } from './routes/work.js';
import { recordRoutes } from './routes/records.js';
import { adminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(store) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), database: store.db.isMemory ? 'memory' : 'firestore' }));
  app.use('/api/auth', authRoutes(store));
  const auth = authenticate(store);
  app.use('/api', auth, workRoutes(store));
  app.use('/api', auth, recordRoutes(store));
  app.use('/api', auth, adminRoutes(store));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Serve the built web app in production
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong on the server. The error has been logged.' });
  });
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const store = await getStore();
  try {
    const anyUser = await store.db.collection('users').limit(1).get();
    if (anyUser.empty && store.db.isMemory) {
      const { seedDemo, DEMO_ACCOUNTS_TEXT } = await import('./seed.js');
      await seedDemo(store);
      console.log(`In-memory database loaded with demo data (lost on restart).\n${DEMO_ACCOUNTS_TEXT}`);
    } else if (anyUser.empty) console.warn('No users found. Run "npm run seed" to create demo data and the first admin account.');
  } catch (e) {
    console.error('Could not reach Firestore. Check the Firebase credentials in .env (see README, Firebase setup).');
    console.error(e.message);
    process.exit(1);
  }
  const app = createApp(store);
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => console.log(`AfyaTrack PHO API running on http://localhost:${port} (database: ${store.db.isMemory ? 'in memory' : 'Cloud Firestore'})`));
  const tick = async () => { try { const n = await runReminders(store); if (n) console.log(`[reminders] ${n} new in app reminder(s)`); } catch (e) { console.error('[reminders]', e.message); } };
  tick();
  setInterval(tick, Number(process.env.REMINDER_INTERVAL_SECONDS || 60) * 1000);
}
