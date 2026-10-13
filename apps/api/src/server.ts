import 'dotenv/config';
import { buildApp } from './app.js';
const app = buildApp();
const port = Number(process.env.API_PORT ?? 4101);
const host = process.env.API_HOST ?? '127.0.0.1';
try { await app.listen({ port, host }); }
catch (error) { app.log.error(error); process.exitCode = 1; }
