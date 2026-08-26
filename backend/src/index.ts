import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.routes.js';
import { mfaRouter } from './routes/mfa.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { sosRouter } from './routes/sos.routes.js';
import { stationRouter } from './routes/station.routes.js';
import { disasterRouter } from './routes/disaster.routes.js';
import { responderRouter } from './routes/responder.routes.js';
import { initializeWebSocket } from './websocket/index.js';
import { apiRateLimiter, sosRateLimiter } from './middleware/rate-limit.middleware.js';
import { MAX_PAYLOAD_SIZE, payloadTooLargeHandler } from './middleware/validation.middleware.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT ?? 3001;

// ─── Security Headers ───────────────────────────────────────────────────────
// Helmet with strict CSP for PWA compatibility (Req 38.4, 38.5)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow PWA service worker
  })
);

// ─── CORS ───────────────────────────────────────────────────────────────────
// Whitelist origins from environment variable (comma-separated) (Req 38.6)
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, ''))
  : true; // Allow all in development when not configured

app.use(
  cors({
    credentials: true,
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Body Parsing with Size Limit ───────────────────────────────────────────
// Block payloads > 10KB (Req 38.2)
app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
app.use(cookieParser());

// ─── Global Rate Limiting ───────────────────────────────────────────────────
// 100 requests per minute per user across all API endpoints (Req 38.3)
app.use('/api', apiRateLimiter);

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/auth/mfa', mfaRouter);
app.use('/api/audit', auditRouter);

// SOS routes with additional per-endpoint rate limiting (10 per min for creation)
app.use('/api/sos', sosRateLimiter, sosRouter);

// Station routes for facility management (police, hospital, relief center)
app.use('/api/stations', stationRouter);

// Disaster event routes
app.use('/api/disasters', disasterRouter);

// Responder routes for status management and queries
app.use('/api/responders', responderRouter);

// ─── Error Handlers ─────────────────────────────────────────────────────────
// Handle payload-too-large errors with consistent JSON response
app.use(payloadTooLargeHandler);

// Initialize WebSocket on the HTTP server
const io = initializeWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`MeshSOS Backend running on port ${PORT}`);
});

export { app, httpServer, io };
