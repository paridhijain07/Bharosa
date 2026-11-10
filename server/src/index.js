import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import { initSockets } from './sockets.js';
import { ensureSeedData } from './services/seed.js';
import { startAlertJob } from './services/alerts.js';
import { startPromiseFollowUpJob } from './services/collector.js';
import tabsRouter from './routes/tabs.js';
import paypalRouter from './routes/paypal.js';
import customersRouter from './routes/customers.js';
import khataRouter from './routes/khata.js';
import devRouter from './routes/dev.js';
import statsRouter from './routes/stats.js';
import assistantRouter from './routes/assistant.js';
import incomeRouter from './routes/income.js';
import dayRouter from './routes/day.js';
import whatsappRouter from './routes/whatsapp.js';
import alertsRouter from './routes/alerts.js';
import vendorRouter from './routes/vendor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from workspace root or server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const app = express();
export const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: 'bharosa-server',
    dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    devMode: process.env.DEV_MODE === 'true',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/tabs', tabsRouter);
app.use('/api/paypal', paypalRouter);
app.use('/api/customers', customersRouter);
app.use('/api/khata', khataRouter);
app.use('/api/dev', devRouter);
app.use('/api/stats', statsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/income', incomeRouter);
app.use('/api/day', dayRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/vendor', vendorRouter);

// Serve static frontend in production if built
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/healthz') {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

export async function startServer(portOverride) {
  const port = portOverride || Number(process.env.PORT || 4000);
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bharosa';

  await mongoose.connect(mongoUri);
  console.log(`[MongoDB] Connected to ${mongoUri}`);

  await ensureSeedData();
  initSockets(server);
  startAlertJob(5000);
  startPromiseFollowUpJob(5 * 60 * 1000);

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[Bharosa Server] Listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

// Auto-start only when index.js is executed directly (not when imported by tests or scripts/simulate.js)
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule && process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[Bharosa Server] Failed to start:', err);
    process.exit(1);
  });
}

