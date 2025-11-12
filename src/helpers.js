export function findValue(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const [subKey, value] of Object.entries(obj)) {
    if (subKey === key) return value;
    if (typeof value === 'object' && value !== null) {
      const result = findValue(value, key);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}

export function roundArea(area) {
  const raw = area ?? '';
  const num = parseFloat(String(raw).replace(',', '.'));
  if (Number.isNaN(num)) return null;
  if (num >= 93 && num <= 94) return 100;
  const remainder = num % 5;
  if (remainder === 0) return num;
  return Math.round((num + (5 - remainder)) / 5) * 5;
}

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? null : num;
}

export function parseBathrooms(text) {
  if (!text || typeof text !== 'string') return {};
  const normalized = text.toLowerCase();
  const combinedMatch = normalized.match(/(\d+)\s*совмещ/);
  const separateMatch = normalized.match(/(\d+)\s*раздель/);
  const combined =
    combinedMatch !== null ? parseInt(combinedMatch[1], 10) : normalized.includes('совмещ') ? 1 : null;
  const separate =
    separateMatch !== null ? parseInt(separateMatch[1], 10) : normalized.includes('раздель') ? 1 : null;
  return { combined, separate };
}

export function normalizeParking(raw) {
  if (!raw) return null;
  const value = String(raw).toLowerCase();
  if (value.includes('подзем')) return 'Подземная';
  if (value.includes('назем') || value.includes('стоян')) return 'Наземная';
  return 'Наземная';
}

export function mergePhotos(primary = [], auxiliary = []) {
  const seen = new Set();
  const merged = [];
  for (const url of [...primary, ...auxiliary]) {
    if (!url) continue;
    if (!seen.has(url)) {
      seen.add(url);
      merged.push(url);
    }
  }
  return merged;
}

export function formatPrice(price) {
  if (price === null || price === undefined) return 'Не указано';
  const rounded = Math.round(Number(price));
  const formatted = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ₽`;
}
