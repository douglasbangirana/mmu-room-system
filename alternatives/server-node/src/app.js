import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import auth from './routes/auth.js';
import rooms from './routes/rooms.js';
import terminal from './routes/terminal.js';
import timetable from './routes/timetable.js';
import { cards, users } from './routes/people.js';
import { logs, settings } from './routes/reports.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind nginx/Caddy in production
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Terminal endpoints first (device-key auth); they share the /api prefix with the dashboard routes.
  app.use('/api', terminal);
  app.use('/api/auth', auth);
  app.use('/api/rooms', rooms);
  app.use('/api/timetable', timetable);
  app.use('/api/cards', cards);
  app.use('/api/users', users);
  app.use('/api', logs);
  app.use('/api/settings', settings);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
  return app;
}
