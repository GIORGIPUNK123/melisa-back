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

// include Windows CAs (Node 24)
const { setDefaultCACertificates, getCACertificates } = tls as any;
setDefaultCACertificates([
  ...getCACertificates(),
  ...getCACertificates('system'),
]);

export const supabase = createClient(
  process.env.DB_URL!,
  process.env.DB_SECRET_KEY!,
);
(async () => {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());

  app.get('/', (req, res) => {
    res.send('melisa');
  });

  app.get('/health', async (_req, res) => {
    try {
      const response = await fetch(`${process.env.DB_URL}/auth/v1/health`, {
        headers: { apikey: process.env.DB_SECRET_KEY ?? '' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('Supabase health check failed');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use('/auth', authRouter);
  app.use('/friends', friendsRouter);
  app.use('/userinfo', userInfoRoute);
  app.use('/users', userInfoRoute);
  app.use('/conversations', conversationsRouter);
  app.get('*', (req, res) => {
    res.send('melisa');
  });
  app.listen(process.env.PORT || 3000, () => {
    console.log(
      `> Ready on ${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`,
    );
  });
})();
