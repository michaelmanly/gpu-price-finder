#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://aibadgr.com/v1';
const LEGACY_BASE_URLS = new Set([
  'https://api.aibadgr.com/v1',
  'https://api.aibadgr.com',
  'http://api.aibadgr.com/v1',
  'http://api.aibadgr.com',
]);
const POSITIONAL_FLAGS = new Set(['--gpu', '--region', '--max-price', '--tier', '--sort', '--limit']);

export function normalizeGpu(gpu) {
  return String(gpu || 'RTX_4090').trim().toUpperCase().replace(/-/g, '_');
}

export function normalizeBaseUrl(url) {
  const trimmed = String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (LEGACY_BASE_URLS.has(trimmed)) return DEFAULT_BASE_URL;
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function parseArgs(argv) {
  const flags = {
    gpu: 'RTX_4090',
    sort: 'price',
    limit: 5,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (!POSITIONAL_FLAGS.has(arg)) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;
    if (arg === '--gpu') flags.gpu = normalizeGpu(value);
    if (arg === '--region') flags.region = value.toUpperCase();
    if (arg === '--max-price') flags.maxPrice = parsePositiveNumber(value, '--max-price');
    if (arg === '--tier') flags.tier = parseTier(value);
    if (arg === '--sort') flags.sort = parseSort(value);
    if (arg === '--limit') flags.limit = parseLimit(value);
  }

  flags.gpu = normalizeGpu(flags.gpu);
  return flags;
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
}

function parseTier(value) {
  const tier = String(value).trim();
  if (tier !== '1' && tier !== '2') {
    throw new Error('--tier must be 1 or 2');
  }
  return Number(tier);
}

function parseSort(value) {
  const sort = String(value).trim().toLowerCase();
  if (sort !== 'price') {
    throw new Error('--sort currently supports only price');
  }
  return sort;
}

function parseLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('--limit must be an integer from 1 to 50');
  }
  return limit;
}

export function buildSearchUrl(flags, baseUrl = process.env.BADGR_GPU_SEARCH_API_URL || process.env.BADGR_API_URL || DEFAULT_BASE_URL) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/capacity/search`);
  url.searchParams.set('gpu', normalizeGpu(flags.gpu));
  url.searchParams.set('sort', flags.sort || 'price');
  url.searchParams.set('limit', String(flags.limit ?? 5));
  if (flags.region) url.searchParams.set('region', flags.region.toUpperCase());
  if (flags.maxPrice !== undefined) url.searchParams.set('max_price', String(flags.maxPrice));
  if (flags.tier !== undefined) url.searchParams.set('tier', String(flags.tier));
  return url;
}

export function normalizeRoutes(data, flags) {
  const rawRoutes = Array.isArray(data) ? data : (data.routes || data.matches || []);
  const routes = rawRoutes.map((route, index) => {
    const price = route.price_per_hour ?? route.price ?? route.cost_per_gpu_hour;
    return {
      source: route.source || `Source ${index + 1}`,
      tier: Number(route.tier ?? 1),
      gpu: normalizeGpu(route.gpu || flags.gpu),
      price_per_hour: Number(price),
      region: String(route.region || 'any').toUpperCase(),
      available: route.available !== false,
    };
  }).filter((route) => Number.isFinite(route.price_per_hour));

  if ((flags.sort || 'price') === 'price') {
    routes.sort((a, b) => a.price_per_hour - b.price_per_hour);
  }
  return routes.slice(0, flags.limit ?? 5).map((route, index) => ({
    ...route,
    source: `Source ${index + 1}`,
  }));
}

export async function fetchRoutes(flags, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This CLI requires Node.js 18+ with fetch support');
  }
  const url = buildSearchUrl(flags);
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data?.message || data?.detail || response.statusText || 'capacity search failed';
    throw new Error(`AI Badgr route search failed (HTTP ${response.status}): ${message}`);
  }
  return normalizeRoutes(data || [], flags);
}

function formatPrice(price) {
  return `$${price.toFixed(2)}/hr`;
}

export function formatTextOutput(routes, flags) {
  const gpu = normalizeGpu(flags.gpu);
  if (routes.length === 0) {
    const priceText = flags.maxPrice !== undefined ? ` under $${Number(flags.maxPrice).toFixed(2)}/hr` : '';
    return [
      `No ${gpu} routes found${priceText}.`,
      '',
      'Try:',
      `npx gpu-price-finder --gpu ${gpu} --max-price 1`,
      `npx gpu-price-finder --gpu ${gpu} --tier 2`,
      'npx gpu-price-finder --gpu RTX_3090 --max-price 1',
      '',
      'Powered by AI Badgr.',
      'Find cheap GPU routes. Run workloads with spend caps.',
      '',
    ].join('\n');
  }

  const lines = [
    'Searching AI Badgr routes...',
    '',
    `Cheapest ${gpu} routes:`,
    '',
  ];
  routes.forEach((route, index) => {
    const status = route.available ? 'available' : 'unavailable';
    lines.push(`${index + 1}. ${route.source}   ${formatPrice(route.price_per_hour)}   Tier ${route.tier}   ${route.region}   ${status}`);
  });

  lines.push(
    '',
    'Recommendation',
    'Use:',
    '',
    `npx gpu-price-finder --gpu ${gpu} --max-price 1`,
    '',
    'Powered by AI Badgr.',
    'Find cheap GPU routes. Run workloads with spend caps.',
    '',
  );
  return lines.join('\n');
}

export function helpText() {
  return `Powered by AI Badgr.\nFind cheap GPU routes. Run workloads with spend caps.\n\nUsage:\n  npx gpu-price-finder --gpu RTX_4090 [--region US] [--max-price 1] [--tier 2] [--sort price] [--limit 5] [--json]\n\nDefaults:\n  --gpu RTX_4090\n  --sort price\n  --limit 5\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(helpText());
    return;
  }
  const routes = await fetchRoutes(flags);
  if (flags.json) {
    console.log(JSON.stringify(routes, null, 2));
    return;
  }
  console.log(formatTextOutput(routes, flags));
}

export function isCliEntry() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invoked);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
