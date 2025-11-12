import dotenv from 'dotenv';
import express from 'express';
import { runParsingCycle, manualResumeAntiznak } from './parserService.js';
import { notifyLog } from './notifications.js';

dotenv.config();

const PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 3000;
const INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS, 10) || 5 * 60 * 1000;
const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET;
const ANTIZNAK_RESUME_TOKEN = process.env.ANTIZNAK_RESUME_TOKEN;

const app = express();
app.use(express.json());

let isRunning = false;

function formatReason(reason) {
  if (reason === 'webhook') return 'вебхук';
  if (reason === 'interval') return `плановая проверка (каждые ${INTERVAL_MS / 60000} мин)`;
  if (reason === 'startup') return 'стартап';
  return reason;
}

async function triggerCycle(reason) {
  if (isRunning) return;
  isRunning = true;
  const reasonLabel = formatReason(reason);
  const preCheckMessage = `Проверка owners с parsed=false запущена (${reasonLabel}).`;
  console.log(preCheckMessage);
  await notifyLog(preCheckMessage);
  try {
    await runParsingCycle({ reason: reasonLabel });
  } finally {
    isRunning = false;
  }
}

app.post('/webhook', async (req, res) => {
  if (WEBHOOK_SECRET && req.headers['x-supabase-signature'] !== WEBHOOK_SECRET) {
    console.warn('Webhook отклонён: подпись не совпадает');
    return res.status(401).json({ error: 'invalid signature' });
  }
  const ownerId = req.body?.owner_id;
  const message = `Webhook triggered (${ownerId ?? 'owner unknown'})`;
  console.log(message);
  await notifyLog(message);
  triggerCycle('webhook');
  res.json({ status: 'scheduled' });
});

app.get('/health', (req, res) => {
  res.json({ status: isRunning ? 'busy' : 'idle' });
});

app.get('/antiznak/resume', async (req, res) => {
  if (!ANTIZNAK_RESUME_TOKEN) {
    return res.status(500).json({ error: 'resume token not configured' });
  }
  if (req.query.token !== ANTIZNAK_RESUME_TOKEN) {
    console.warn('Неверный токен возобновления антизнака');
    return res.status(403).json({ error: 'invalid token' });
  }
  await manualResumeAntiznak();
  res.json({ status: 'resumed' });
});

app.listen(PORT, () => {
  console.log(`Parser webhook listening on port ${PORT}`);
  triggerCycle('startup');
  setInterval(() => triggerCycle('interval'), INTERVAL_MS);
});

app.on('error', err => {
  console.error('Ошибка Express-сервера', err);
});
