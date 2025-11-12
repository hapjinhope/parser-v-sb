import { readFile } from 'node:fs/promises';
import fetch from 'node-fetch';

const cache = new Map();
const DATA_PLACEHOLDER = '{{DATA_JSON}}';

function buildContext(item, owner) {
  const address = item?.address || owner?.url || 'Адрес не указан';
  return {
    address,
    price: item?.price ?? item?.payment,
    rooms: item?.rooms ?? item?.rooms_count,
    total_area: item?.total_area,
    living_area: item?.living_area,
    kitchen_area: item?.kitchen_area,
    floor: item?.floor,
    floors_total: item?.floors_total,
    summary: item?.summary || item?.description,
    bonuses: item?.amenities,
    source: owner?.url
  };
}

function defaultDescription(item, owner) {
  const fragments = [];
  const address = item?.address || owner?.url || 'Адрес не указан';
  fragments.push(`Адрес: ${address}`);
  const price = item?.price ? `${Math.round(item.price)} ₽` : 'Цена не указана';
  fragments.push(`Цена: ${price}`);
  const rooms = item?.rooms ?? item?.rooms_count;
  if (rooms) fragments.push(`Комнат: ${rooms}`);
  const area = item?.total_area;
  if (area) fragments.push(`Площадь: ${area} м²`);
  const summary = item?.summary || item?.description;
  if (summary) fragments.push(summary);
  return fragments.join('. ') + '.';
}

async function loadPrompt(path) {
  if (cache.has(path)) return cache.get(path);
  try {
    const content = await readFile(path, 'utf8');
    cache.set(path, content);
    return content;
  } catch (error) {
    return null;
  }
}

function resolveText(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  const candidate =
    payload?.text ??
    payload?.result ??
    payload?.message ??
    payload?.content ??
    payload?.choice ??
    null;
  if (typeof candidate === 'string') return candidate;
  if (Array.isArray(payload?.choices) && payload.choices.length > 0) {
    return (
      payload.choices[0]?.text ??
      payload.choices[0]?.message?.content ??
      payload.choices[0]?.content ??
      null
    );
  }
  if (Array.isArray(payload?.output) && payload.output.length > 0) {
    return payload.output[0]?.content ?? payload.output[0]?.text ?? null;
  }
  if (Array.isArray(payload?.items) && payload.items.length > 0) {
    return resolveText(payload.items[0]);
  }
  return null;
}

export async function generateDescription(item = {}, owner = {}, options = {}) {
  const fallback = defaultDescription(item, owner);
  if (!options.apiUrl || !options.apiKey) return fallback;
  const promptTemplate = await loadPrompt(options.promptPath);
  if (!promptTemplate) return fallback;

  const jsonData = JSON.stringify(buildContext(item, owner), null, 2);
  const prompt = promptTemplate.replace(DATA_PLACEHOLDER, jsonData);

  const payload = {
    model: options.model ?? 'polza-1',
    prompt,
    max_tokens: options.maxTokens ?? 400,
    temperature: options.temperature ?? 0.65
  };

  try {
    const response = await fetch(options.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Polza AI ${response.status}`);
    const json = await response.json();
    const reply = resolveText(json);
    if (reply) return reply.trim();
    return fallback;
  } catch (error) {
    return fallback;
  }
}
