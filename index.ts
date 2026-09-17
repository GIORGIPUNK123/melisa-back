import { config } from 'dotenv';
config();
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { authRouter } from './routes/authRouter';
import { friendsRouter } from './routes/friendsRouter';
import { userInfoRoute } from './routes/userInfoRoute';
import { conversationsRouter } from './routes/conversationsRouter';

// Initialize Supabase Client
export const supabase = createClient(
  process.env.DB_URL!,
  process.env.DB_SECRET_KEY!,
);

const app = express();

// Allowed origins setup
const allowedOrigins = [
  'https://melisa-phi.vercel.app',
  ...(process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL.replace(/\/+$/, '')]
    : []),
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server) or listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS Not Allowed'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Enable CORS middleware globally
app.use(cors(corsOptions));

// Explicitly handle preflight OPTIONS requests across all routes
app.options('*', cors(corsOptions) as express.RequestHandler);

// Body Parsers (using built-in Express parsers instead of body-parser)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Base & Health Routes
app.get('/', (_req, res) => {
  res.send('melisa');
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API Routes
app.use('/auth', authRouter);
app.use('/friends', friendsRouter);
app.use('/userinfo', userInfoRoute);
app.use('/users', userInfoRoute);
app.use('/conversations', conversationsRouter);

// Fallback Route for unhandled GET requests
app.get('*', (_req, res) => {
  res.send('melisa');
});

// Start Server
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`> Ready on ${port}`);
});
