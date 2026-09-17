import { config } from 'dotenv';
config();
import tls from 'node:tls';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { authRouter } from './routes/authRouter';
import { friendsRouter } from './routes/friendsRouter';
import { userInfoRoute } from './routes/userInfoRoute';
import bodyParser from 'body-parser';
import { conversationsRouter } from './routes/conversationsRouter';

try {
  const { setDefaultCACertificates, getCACertificates } = tls as any;
  if (typeof setDefaultCACertificates === 'function') {
    setDefaultCACertificates([
      ...getCACertificates(),
      ...getCACertificates('system'),
    ]);
  }
} catch {
  // Node on Render already has public CAs
}

export const supabase = createClient(
  process.env.DB_URL!,
  process.env.DB_SECRET_KEY!,
);
(async () => {
  const app = express();

  const allowedOrigin = (
    process.env.FRONTEND_URL || 'https://melisa-phi.vercel.app'
  ).replace(/\/+$/, '');

  app.use(
    cors({
      origin: allowedOrigin,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    }),
  );
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());

  app.get('/', (req, res) => {
    res.send('melisa');
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/friends', friendsRouter);
  app.use('/userinfo', userInfoRoute);
  app.use('/users', userInfoRoute);
  app.use('/conversations', conversationsRouter);
  app.get('*', (req, res) => {
    res.send('melisa');
  });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`> Ready on ${port}`);
  });
})();
