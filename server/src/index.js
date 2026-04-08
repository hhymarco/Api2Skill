/**
 * api2skill backend server entry point.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const analyzeRouter = require('./routes/analyze');
const generateRouter = require('./routes/generate');
const authRouter = require('./routes/auth');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// CORS
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 86400,
}));

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// Handle malformed JSON
app.use((err, _req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid request: request body is not valid JSON',
      data: null,
    });
  }
  next(err);
});

// Routes
app.use('/api/v1', analyzeRouter);
app.use('/api/v1', generateRouter);
app.use('/api/v1', authRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Not found',
    data: null,
  });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    data: null,
  });
});

app.listen(PORT, () => {
  console.log(`[api2skill] Server listening on port ${PORT}`);
});
