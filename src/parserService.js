import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import {
  findValue,
  roundArea,
  parseNumber,
  parseBathrooms,
  normalizeParking,
  mergePhotos,
  formatPrice
} from './helpers.js';
import { generateDescription } from './polzaDescription.js';
import { notifyStatus, notifyLog } from './notifications.js';

dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PARSER_ENDPOINT = 'https://parser-links-production.up.railway.app/parse',
  ANTIZNAK_API_URL = 'https://antiznak.ru/api/v2.php',
  ANTIZNAK_API_KEY,
  ANTIZNAK_ACTION = 'getPhotos',
  POLZA_API_URL,
  POLZA_API_KEY,
  POLZA_MODEL,
  POLZA_PROMPT_FILE = 'prompts/description.txt',
  POLZA_MAX_TOKENS = '400',
  POLZA_TEMPERATURE = '0.65',
  AGENT_ID = '132466118',
  PUBLIC_BASE_URL,
  ANTIZNAK_RESUME_TOKEN
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required to run the parser');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const MAIN_PHOTO_INDEX = 1;
const agentId = parseInt(AGENT_ID, 10) || 132466118;
let antiznakPaused = false;
let lastAntiznakBalance = null;
const sanitizedBaseUrl = PUBLIC_BASE_URL ? PUBLIC_BASE_URL.replace(/\/+$/, '') : null;

function buildResumeUrl() {
  if (!sanitizedBaseUrl || !ANTIZNAK_RESUME_TOKEN) return null;
  const url = new URL('/antiznak/resume', sanitizedBaseUrl);
  url.searchParams.set('token', ANTIZNAK_RESUME_TOKEN);
  return url.toString();
}

async function notifyAntiznakPause() {
  const resumeUrl = buildResumeUrl();
  const message =
    '🚨 Парсер в СБ\n' +
    'Баланс антизнака 0 — публикации остановлены, нужно пополнить баланс.\n' +
    'После пополнения нажмите кнопку, чтобы продолжить процесс.';
  const replyMarkup = resumeUrl
    ? {
        inline_keyboard: [
          [
            {
              text: '✅ Баланс пополнен, продолжить',
              url: resumeUrl
            }
          ]
        ]
      }
    : undefined;
  await notifyLog(message, { replyMarkup });
}

async function resumeAntiznakProcessing(manual = false) {
  antiznakPaused = false;
  await notifyLog(
    manual
      ? '✅ Баланс антизнака пополнен, публикации возобновлены.'
      : 'ℹ️ Баланс антизнака обновлён, публикации возобновлены.'
  );
}

function normalizeBalance(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

async function handleAntiznakBalance(balanceValue) {
  lastAntiznakBalance = balanceValue;
  if (balanceValue === 0) {
    if (!antiznakPaused) {
      antiznakPaused = true;
      await notifyAntiznakPause();
    }
    return false;
  }
  if (antiznakPaused && balanceValue > 0) {
    await resumeAntiznakProcessing();
  }
  return true;
}

export async function manualResumeAntiznak() {
  await resumeAntiznakProcessing(true);
}

function buildPhotoMap(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return { mainPhotoUrl: null, photosJson: null };
  const mainPhotoUrl = photos[MAIN_PHOTO_INDEX] || photos[0] || null;
  const additional = photos.slice(MAIN_PHOTO_INDEX + 1).filter(Boolean);
  const photosJson = additional.length > 0
    ? Object.fromEntries(additional.map((url, index) => [index + 1, url]))
    : null;
  return { mainPhotoUrl, photosJson };
}

function extractItem(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.items) && payload.items.length > 0) {
    return payload.items[0];
  }
  if (payload.item) return payload.item;
  return payload;
}

async function fetchParserPayload(url) {
  const response = await fetch(PARSER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!response.ok) {
    throw new Error(`Parser ${response.status}`);
  }
  return response.json();
}

async function fetchAntiznakPhotos(targetUrl) {
  if (!ANTIZNAK_API_KEY || !targetUrl) {
    return { photos: [], balance: null };
  }
  try {
    const params = new URLSearchParams({
      k: ANTIZNAK_API_KEY,
      key: ANTIZNAK_API_KEY,
      action: ANTIZNAK_ACTION,
      url: targetUrl,
      u: targetUrl
    });
    const response = await fetch(`${ANTIZNAK_API_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Antiznak ${response.status}`);
    }
    const json = await response.json();
    if (json?.status === 'error') {
      const errText = json?.text ?? 'ошибка Antiznak';
      const errCode = json?.err_code ?? '0';
      const balanceValue = normalizeBalance(json?.balance ?? null);
      await notifyLog(`Антизнак ошибка ${errCode}: ${errText}`);
      console.warn(`Антизнак ответил ошибкой ${errCode}: ${errText}`);
      return {
        photos: [],
        balance: balanceValue
      };
    }

    const rawPhotos =
      json?.photos ??
      json?.data?.photos ??
      json?.result?.photos ??
      json?.data?.result?.photos ??
      json?.photo ??
      json?.data?.photo ??
      (Array.isArray(json) ? json : []);
    const balanceRaw =
      json?.balance ??
      json?.data?.balance ??
      json?.result?.balance ??
      json?.data?.result?.balance ??
      json?.data?.account?.balance ??
      json?.account?.balance ??
      null;
    const balance = normalizeBalance(balanceRaw);
    if (balance !== null && balance !== undefined) {
      lastAntiznakBalance = balance;
    }
    return {
      photos: Array.isArray(rawPhotos) ? rawPhotos.filter(Boolean) : [],
      balance
    };
  } catch (error) {
    await notifyLog(`Антизнак не ответил: ${error.message}`);
    return { photos: [], balance: null };
  }
}

async function handleUnpublished(owner) {
  await supabase.from('objects').delete().eq('cian_url', owner.url);
  await supabase.from('owners').delete().eq('id', owner.id);
  const text =
    `⚠️ <b>Объявление ${owner.url} было снято с публикации</b>\n` +
    `owners id: ${owner.id} — запись удалена`;
  await notifyLog(text);
}

async function processOwner(owner) {
  if (!owner?.url) {
    await notifyLog(`У владельца ${owner?.id} отсутствует url`);
    return;
  }

  let parserPayload;
  try {
    parserPayload = await fetchParserPayload(owner.url);
  } catch (error) {
    await notifyLog(`Ошибка парсинга owners ${owner.id}: парсер не ответил (${error.message})`);
    return;
  }

  const item = extractItem(parserPayload);
  if (!item) {
    await notifyLog(`Ошибка парсинга owners ${owner.id}: парсер вернул пустой элемент`);
    return;
  }

  const remoteStatus = (parserPayload.status ?? item.status ?? '')
    .toString()
    .trim()
    .toLowerCase();

  if (remoteStatus === 'unpublished') {
    await handleUnpublished(owner);
    return;
  }

  const parserPhotos = Array.isArray(findValue(item, 'photos')) ? findValue(item, 'photos') : [];
  const { photos: antiznakPhotos, balance: antiznakBalance } = await fetchAntiznakPhotos(owner.url);
  const balanceOk = await handleAntiznakBalance(antiznakBalance);
  if (!balanceOk) {
    throw new Error('Баланс антизнака 0');
  }
  const photos = mergePhotos(parserPhotos, antiznakPhotos);
  const photosData = buildPhotoMap(photos);

  const parsedPrice = parseNumber(findValue(item, 'price'));
  const parsedDeposit = parseNumber(findValue(item, 'payment_deposit') ?? findValue(item, 'deposit'));
  const parsedPrepay = parseNumber(findValue(item, 'payment_prepay') ?? findValue(item, 'prepayment'));

  const totalAreaRounded = roundArea(findValue(item, 'total_area'));
  const livingAreaRounded = roundArea(findValue(item, 'living_area'));
  const kitchenAreaRounded = roundArea(findValue(item, 'kitchen_area'));

  const totalAreaNum = typeof totalAreaRounded === 'number' ? totalAreaRounded : parseNumber(totalAreaRounded);
  const livingAreaNum =
    typeof livingAreaRounded === 'number' ? livingAreaRounded : parseNumber(livingAreaRounded);
  const kitchenAreaNum =
    typeof kitchenAreaRounded === 'number' ? kitchenAreaRounded : parseNumber(kitchenAreaRounded);

  const bathroom = findValue(item, 'bathroom') || '';
  const { combined, separate } = parseBathrooms(bathroom);

  const balconyCount = parseInt(findValue(item, 'balcony_count') ?? findValue(item, 'balconies') ?? '0', 10);
  const loggiaCount = parseInt(findValue(item, 'loggia_count') ?? findValue(item, 'loggias') ?? '0', 10);

  const parking = normalizeParking(findValue(item, 'parking'));
  const typeRaw = findValue(item, 'object_type') ?? findValue(item, 'summary') ?? '';
  const type = String(typeRaw).toLowerCase().includes('апарт') ? 'апартаменты' : 'квартира';

  const amenitiesRaw = findValue(item, 'amenities');
  const amenitiesList = Array.isArray(amenitiesRaw) ? amenitiesRaw : [];

  const description = await generateDescription(item, owner, {
    apiUrl: POLZA_API_URL,
    apiKey: POLZA_API_KEY,
    model: POLZA_MODEL,
    promptPath: POLZA_PROMPT_FILE,
    maxTokens: Number(POLZA_MAX_TOKENS) || 400,
    temperature: Number(POLZA_TEMPERATURE) || 0.65
  });

  const objectPayload = {
    owners_id: owner.id,
    address: findValue(item, 'address') || owner.url,
    description,
    floor: parseInt(findValue(item, 'floor'), 10) || null,
    total_floors: parseInt(findValue(item, 'floors_total'), 10) || null,
    rooms: parseInt(findValue(item, 'rooms') ?? findValue(item, 'rooms_count'), 10) || null,
    agent_id: agentId,
    main_photo_index: MAIN_PHOTO_INDEX,
    main_photo_url: photosData.mainPhotoUrl,
    photos_json: photosData.photosJson,
    complex_name: findValue(item, 'jk') || findValue(item, 'complex') || null,
    promotion_type: 'noPromotion',
    promotion_bet: null,
    price: parsedPrice ?? null,
    deposit: parsedDeposit ?? null,
    prepayment: Number.isFinite(parsedPrepay) ? parsedPrepay : 1,
    conditioner: amenitiesList.some(a => String(a).toLowerCase().includes('кондиционер')),
    bathtub: String(bathroom).toLowerCase().includes('ванн'),
    shower: String(bathroom).toLowerCase().includes('душ'),
    total_area: totalAreaNum ?? null,
    living_area: livingAreaNum ?? null,
    kitchen_area: kitchenAreaNum ?? null,
    combined_bathroom: combined ?? null,
    separate_bathroom: separate ?? null,
    balconies: Number.isFinite(balconyCount) ? balconyCount : null,
    loggias: Number.isFinite(loggiaCount) ? loggiaCount : null,
    ceiling_height: parseInt(findValue(item, 'ceiling_height'), 10) || null,
    parking,
    status: 'draft',
    type,
    cian_url: owner.url,
    children: true,
    pets: true,
    layout: 'Смежно-Изолированная',
    repair: 'Дизайнерский',
    windowtype: 'На улицу и двор',
    prepayment: 1,
    termtype: 'От года',
    utilites: 'включена (без счётчиков)',
    fridge: true,
    washer: true,
    tv: true,
    internet: true,
    furniture: true,
    kitchenfurniture: true,
    passenger_elevator: 1,
    freight_elevator: 1,
    category: 'flatRent'
  };

  const objectsResponse = await supabase.from('objects').insert(objectPayload).select('id, external_id').single();

  if (objectsResponse.error) {
    await notifyLog(
      `Ошибка парсинга owners ${owner.id}: не удалось записать объект (${objectsResponse.error.message})`
    );
    return;
  }

  await supabase
    .from('owners')
    .update({ parsed: 'true', status: true, updated_at: new Date().toISOString() })
    .eq('id', owner.id);

  const priceText = objectPayload.price ? formatPrice(objectPayload.price) : 'Не указана';
  const extId = objectsResponse.data?.external_id ?? '—';
  const objectId = objectsResponse.data?.id ?? '—';
  const successLog = [
    '✅ Парсер дубля выполнен',
    `owners: ${owner.id}`,
    `objects: ${objectId} (external: ${extId})`,
    `Баланс Антизнака: ${lastAntiznakBalance ?? 'нет данных'}`
  ].join('\n');
  await notifyLog(successLog);

  const message = [
    '🆕 <b>Новый объект в процессе публикации</b>',
    '',
    `📄 <b>Объявление №${extId}</b>`,
    `📍 <b>Адрес:</b> ${objectPayload.address}`,
    `💰 <b>Цена:</b> ${priceText}`,
    `🔗 <b>Ссылка:</b> <a href="${owner.url}">Открыть объявление</a>`
  ].join('\n');
  await notifyStatus(message);
}

async function sendCycleSummary(totalOwners, processed, errors, reason) {
  if (!errors.length) return;
  const baseStatus =
    errors.length > 0
      ? `Задача не выполнена: ${errors.length} ошибка${errors.length === 1 ? '' : 'ок'}`
      : `Задача выполнена${processed ? ` (${processed} объектов)` : ''}`;
  const reasonSuffix = reason ? ` (${reason})` : '';
  const balanceLine =
    lastAntiznakBalance !== null && lastAntiznakBalance !== undefined
      ? `Антизнак баланс: ${lastAntiznakBalance}`
      : 'Антизнак баланс: нет данных';
  const message = [
    `${baseStatus}${reasonSuffix}`,
    `Всего проверено: ${totalOwners}, успешно: ${processed}, с ошибками: ${errors.length}`,
    balanceLine
  ].join('\n');
  await notifyLog(message);
  console.log(`Итог цикла:\n${message}`);
}

export async function runParsingCycle(context = { reason: 'scheduled' }) {
  const reasonText = context.reason || context;
  console.log(`Запуск цикла парсинга (${reasonText})`);
  const { data: owners, error } = await supabase
    .from('owners')
    .select('*')
    .ilike('parsed', 'false')
    .limit(20);
  console.log(`Найдено owners с parsed=false: ${owners?.length ?? 0}`);

  if (error) {
    console.error('Supabase owners read error', error);
    await notifyLog(`Не удалось прочитать owners: ${error.message}`);
    await sendCycleSummary(0, 0, [error], 'ошибка при чтении owners');
    return;
  }

  if (!owners?.length) {
    console.log('Нет объектов для обработки');
    await sendCycleSummary(0, 0, [], 'нет ссылок');
    return;
  }

  let processedCount = 0;
  const errors = [];
  console.log(`Обрабатывается ${owners.length} объектов`);

  for (const owner of owners) {
    try {
      await processOwner(owner);
      processedCount += 1;
    } catch (error) {
      console.error('processOwner error', owner.id, error);
      errors.push(error);
      await notifyLog(`Ошибка парсинга owners ${owner.id}: ${error.message}`);
    }
  }

  console.log('Цикл парсинга завершён');
  await sendCycleSummary(owners.length, processedCount, errors, errors.length ? 'в ходе обработки' : undefined);
}
