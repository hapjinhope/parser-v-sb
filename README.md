# Supabase Cian Parser

This utility runs as a lightweight scheduler + webhook receiver. It looks for entries in the `owners` table where `parsed = false`, feeds each link through the external parser, enriches the photos via Antiznak, writes a well-formed record into the `objects` table, and keeps the `owners` row (parsed/status flags) in sync. New objects notify your publishing chat and all operational logs (errors / balance issues) go to the dedicated Telegram log stream.

## Setup
1. Copy `.env.example` to `.env` and populate the credentials and URLs (Supabase service role key, Telegram bot tokens, Antiznak key, Polza AI key, etc.).
2. Run `npm install` to install the runtime dependencies.

## Environment variables
- `SUPABASE_URL` – your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` – service-role key with insert/update/delete permissions.
- `SUPABASE_WEBHOOK_SECRET` – the exact value Supabase will add to `x-supabase-signature` when calling the webhook.
- `WEBHOOK_PORT` – port for the Express webhook + scheduler server (default 3000).
- `CHECK_INTERVAL_MS` – poll interval for the background worker (default 60000 = 1 minute).
- `PARSER_ENDPOINT` – URL of the general-purpose parser service.
- `ANTIZNAK_API_URL` – Antiznak photo endpoint.
- `ANTIZNAK_API_KEY` – API key for Antiznak (`DYD477UFJ5` or your own value).
- `ANTIZNAK_ACTION` – action parameter for Antiznak (default `getPhotos`).
- `TELEGRAM_STATUS_BOT_TOKEN` / `TELEGRAM_STATUS_CHAT_ID` – bot/token that receives new-object notifications (e.g., ‑1003115748610).
- `TELEGRAM_STATUS_TOPIC_ID` – optional topic/thread within the status chat (set to `2` if your channel uses threads); status messages still land in that topic.
- `TELEGRAM_LOG_BOT_TOKEN` / `TELEGRAM_LOG_CHAT_ID` – bot/token that receives logging messages and operational alerts (channel `https://t.me/c/3401481436/2`).
- `TELEGRAM_LOG_TOPIC_ID` – leave empty when вы убрали темы; заполните номер темы, если хотите отправлять сообщения в конкретный тред.
- `LOG_TELEGRAM_REQUESTS` – set to `false`, если не хотите видеть в консоли строки “Отправка Telegram-сообщения…”.
- `POLZA_API_URL` / `POLZA_API_KEY` – endpoint and key for generating descriptions via Polza AI.
- `POLZA_MODEL`, `POLZA_PROMPT_FILE`, `POLZA_MAX_TOKENS`, `POLZA_TEMPERATURE` – optional Polza settings; set `POLZA_MODEL` to whichever Polza variant you need (e.g., `polza-1` or `polza-2`), the prompt defaults to `prompts/description.txt`, and `POLZA_MODEL_OPTIONS` lists the variants you can switch between.
- `PUBLIC_BASE_URL` – публичный адрес сервиса (используется для кнопки “✅ Баланс пополнен, продолжить”).
- `ANTIZNAK_RESUME_TOKEN` – токен, который должен совпадать в `/antiznak/resume?token=…`, чтобы возобновить работу после пополнения баланса.
- `SUPABASE_STORAGE_BUCKET` – имя публичного бакета Storage, куда складываются фото Антизнака (в `objects` сохраняются именно эти постоянные ссылки).
- `ANTIZNAK_INITIAL_DELAY_MS` / `ANTIZNAK_RETRY_DELAY_MS` / `ANTIZNAK_MAX_ATTEMPTS` – регулируют ожидание фотографий от Антизнака: первая пауза перед запросом, интервал между повторными проверками (по умолчанию 15 секунд) и максимальное число попыток, прежде чем сообщить об ошибке “Нет фото от Антизнака”.

## Prompt file
The file `prompts/description.txt` controls how Polza AI receives the listing data. The script replaces `{{DATA_JSON}}` with the current payload before calling the API. Update it if you need a different tone or more fields in the prompt.

## Running
```
npm run start
```
`npm start` boots an Express server that: (1) runs `runParsingCycle()` immediately, (2) schedules it every `CHECK_INTERVAL_MS`, and (3) listens for POST requests on `/webhook` (Supabase can call it to trigger an immediate run). When new objects are published you receive the Telegram message you described; unpublished responses delete the object and send a warning to the log chat.

## Supabase webhook
Configure a Supabase trigger or a scheduled function to POST to `http://your-host/webhook` with header `x-supabase-signature` equal to `SUPABASE_WEBHOOK_SECRET`. The payload can be empty; reception simply enqueues a parsing cycle if the worker is idle. Each POST immediately sends a message to the log chat (see `"Webhook triggered …"`), so you can test the integration with:
```
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-supabase-signature: your-secret" \
  -d '{"owner_id":17}'
```
and watch the Telegram log chat for the scheduled/started cycle notification.

## Behavior notes
- Areas, prices, and bathroom counts are normalized similarly to your original logic.
- Parser photos are merged with Antiznak photos before building `photos_json` so every extra image is available for Supabase.
- Telegram notifications reuse your template (address, price, link) and every operational log/alert is mirrored to the log chat.
- When Polza AI fails, the script still emits a short fallback description based on the raw data.
- Если баланс Антизнака падает до нуля, цикл приостанавливается: в лог-чат уходит сообщение “Парсер в СБ… публикации остановлены” с кнопкой “✅ Баланс пополнен, продолжить”. После пополнения нажмите кнопку (она дергает `/antiznak/resume?token=…`) – парсер возобновит работу и отправит уведомление, что публикации снова идут.
