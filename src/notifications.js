import fetch from 'node-fetch';

const STATUS_BOT_TOKEN = process.env.TELEGRAM_STATUS_BOT_TOKEN;
const STATUS_CHAT_ID = process.env.TELEGRAM_STATUS_CHAT_ID;
const STATUS_TOPIC_ID = process.env.TELEGRAM_STATUS_TOPIC_ID;
const LOG_BOT_TOKEN = process.env.TELEGRAM_LOG_BOT_TOKEN;
const LOG_CHAT_ID = process.env.TELEGRAM_LOG_CHAT_ID;
const LOG_TOPIC_ID = process.env.TELEGRAM_LOG_TOPIC_ID;

const CHAT_LABELS = new Map([
  [STATUS_CHAT_ID, 'Статус'],
  [LOG_CHAT_ID, 'Логи']
]);

function describeChat(chatId) {
  const label = CHAT_LABELS.get(chatId);
  return label ? `${chatId} (${label})` : chatId;
}

async function sendTelegramMessage(token, chatId, text, options = {}) {
  if (!token || !chatId || !text) return false;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text
  };
  if (options.message_thread_id) {
    body.message_thread_id = options.message_thread_id;
  }
  if (options.reply_markup) {
    body.reply_markup = options.reply_markup;
  }

  try {
    console.log(
      `Отправка Telegram-сообщения в чат ${describeChat(chatId)}${
        options.message_thread_id ? ' (тема ' + options.message_thread_id + ')' : ''
      }`
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Ошибка Telegram:', data);
      return false;
    }
    console.log('Telegram-сообщение отправлено', {
      chat: describeChat(chatId),
      messageId: data.result?.message_id
    });
    return true;
  } catch (error) {
    console.error('Ошибка запроса Telegram:', error);
    return false;
  }
}

export async function notifyLog(text, options = {}) {
  await sendTelegramMessage(LOG_BOT_TOKEN, LOG_CHAT_ID, text, {
    message_thread_id: LOG_TOPIC_ID ? Number(LOG_TOPIC_ID) : undefined,
    reply_markup: options.replyMarkup
  });
}

export async function notifyStatus(text, options = {}) {
  await sendTelegramMessage(STATUS_BOT_TOKEN, STATUS_CHAT_ID, text, {
    message_thread_id: STATUS_TOPIC_ID ? Number(STATUS_TOPIC_ID) : undefined,
    reply_markup: options.replyMarkup
  });
}
