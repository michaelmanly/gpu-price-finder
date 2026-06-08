#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://aibadgr.com/v1';
const GITHUB_URL = 'https://github.com/michaelmanly/gpu-price-finder';
const SUPPORTED_REGIONS = new Set(['US', 'EU', 'AU']);
const SUPPORTED_GPUS = [
  'RTX_3080', 'RTX_3090', 'RTX_4080', 'RTX_4090', 'RTX_5090',
  'A4000', 'A5000', 'A6000', 'L40S', 'A100', 'H100',
];
export const OVERVIEW_GPUS = ['RTX_4090', 'L40S', 'A100'];
export const OVERVIEW_ROUTES_PER_GPU = 2;
export const DETAILED_DEFAULT_LIMIT = 5;
const LEGACY_BASE_URLS = new Set([
  'https://api.aibadgr.com/v1',
  'https://api.aibadgr.com',
  'http://api.aibadgr.com/v1',
  'http://api.aibadgr.com',
]);
const POSITIONAL_FLAGS = new Set(['--gpu', '--region', '--max-price', '--tier', '--sort', '--limit']);

export function normalizeGpu(gpu) {
  return String(gpu || '').trim().toUpperCase().replace(/-/g, '_');
}

export function routeLabel(index) {
  if (index < 26) return `Route ${String.fromCharCode(65 + index)}`;
  return `Route ${index + 1}`;
}

export function isOverviewMode(flags) {
  return !flags.gpu;
}

export function normalizeBaseUrl(url) {
  const trimmed = String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (LEGACY_BASE_URLS.has(trimmed)) return DEFAULT_BASE_URL;
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function parseArgs(argv) {
  const flags = {
    gpu: undefined,
    sort: 'price',
    limit: undefined,
    json: false,
    full: false,
    availableOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--full') {
      flags.full = true;
      continue;
    }
    if (arg === '--available-only') {
      flags.availableOnly = true;
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
    if (arg === '--region') flags.region = parseRegion(value);
    if (arg === '--max-price') flags.maxPrice = parsePositiveNumber(value, '--max-price');
    if (arg === '--tier') flags.tier = parseTier(value);
    if (arg === '--sort') flags.sort = parseSort(value);
    if (arg === '--limit') flags.limit = parseLimit(value);
  }

  if (flags.gpu) flags.gpu = normalizeGpu(flags.gpu);
  return flags;
}

export function resolveDetailedFlags(flags) {
  return {
    ...flags,
    limit: flags.limit ?? DETAILED_DEFAULT_LIMIT,
  };
}

function parseRegion(value) {
  const region = String(value).trim().toUpperCase();
  if (!SUPPORTED_REGIONS.has(region)) {
    throw new Error('--region must be US, EU, or AU');
  }
  return region;
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
  url.searchParams.set('limit', String(flags.limit ?? DETAILED_DEFAULT_LIMIT));
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
      source: route.source || routeLabel(index),
      tier: Number(route.tier ?? 1),
      gpu: normalizeGpu(route.gpu || flags.gpu),
      price_per_hour: Number(price),
      region: String(route.region || 'any').toUpperCase(),
      available: route.available !== false,
    };
  }).filter((route) => Number.isFinite(route.price_per_hour) && route.price_per_hour > 0);

  if (flags.availableOnly) {
    routes.splice(0, routes.length, ...routes.filter((route) => route.available));
  }

  if ((flags.sort || 'price') === 'price') {
    routes.sort((a, b) => a.price_per_hour - b.price_per_hour);
  }
  const limit = flags.limit ?? DETAILED_DEFAULT_LIMIT;
  return routes.slice(0, limit).map((route, index) => ({
    ...route,
    source: routeLabel(index),
  }));
}

export function normalizeAlternatives(data) {
  const rawAlternatives = Array.isArray(data) ? [] : (data.alternatives || []);
  return rawAlternatives.map((alt) => ({
    gpu: normalizeGpu(alt.gpu),
    region: String(alt.region || 'any').toUpperCase(),
    price_per_hour: Number(alt.price ?? alt.price_per_hour ?? 0),
    diff_desc: alt.diff_desc ? String(alt.diff_desc) : undefined,
  })).filter((alt) => alt.gpu);
}

export async function fetchSearch(flags, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This CLI requires Node.js 18+ with fetch support');
  }
  if (!flags.gpu) {
    throw new Error('fetchSearch requires --gpu');
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
  const payload = data || {};
  return {
    routes: normalizeRoutes(payload, flags),
    alternatives: normalizeAlternatives(payload),
    requested: payload.requested || null,
  };
}

export async function fetchOverview(flags, fetchImpl = globalThis.fetch) {
  const settled = await Promise.allSettled(
    OVERVIEW_GPUS.map(async (gpu) => {
      const gpuFlags = {
        ...flags,
        gpu,
        limit: OVERVIEW_ROUTES_PER_GPU,
      };
      const { routes } = await fetchSearch(gpuFlags, fetchImpl);
      return { gpu, routes };
    }),
  );

  const successes = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((entry) => entry.routes.length > 0);
  const failures = settled.filter((result) => result.status === 'rejected');

  if (successes.length === 0 && failures.length > 0) {
    throw failures[0].reason;
  }
  return successes;
}

export async function fetchRoutes(flags, fetchImpl = globalThis.fetch) {
  const { routes } = await fetchSearch(resolveDetailedFlags(flags), fetchImpl);
  return routes;
}

function formatPrice(price) {
  return `$${price.toFixed(2)}/hr`;
}

function formatAlternativeLines(alternatives, limit = 5) {
  if (!alternatives.length) return [];
  const lines = ['', 'Available alternatives:', ''];
  alternatives.slice(0, limit).forEach((alt, index) => {
    const note = alt.diff_desc ? `   ${alt.diff_desc}` : '';
    lines.push(`${index + 1}. ${alt.gpu}   ${formatPrice(alt.price_per_hour)}   ${alt.region}${note}`);
  });
  return lines;
}

export function formatOverviewOutput(overview) {
  const lines = [
    'Searching GPU routes...',
    '',
    'Cheapest routes right now:',
    '',
  ];

  if (overview.length === 0) {
    lines.push(
      'No routes found right now.',
      '',
      'Try:',
      'npx gpu-price-finder --gpu RTX_4090',
      'npx gpu-price-finder --gpu L40S --tier 2',
      '',
      'Powered by AI Badgr.',
      'Find cheap GPU routes. Run workloads with spend caps.',
      '',
    );
    return lines.join('\n');
  }

  overview.forEach(({ gpu, routes }) => {
    lines.push(gpu);
    routes.forEach((route) => {
      lines.push(`  ${route.source}   ${formatPrice(route.price_per_hour)}`);
    });
    lines.push('');
  });

  lines.push(
    'Drill down:',
    'npx gpu-price-finder --gpu RTX_4090',
    '',
    'Powered by AI Badgr.',
    'Find cheap GPU routes. Run workloads with spend caps.',
    '',
  );
  return lines.join('\n');
}

export function formatTextOutput(routes, flags, alternatives = []) {
  const gpu = normalizeGpu(flags.gpu);
  if (routes.length === 0) {
    const priceText = flags.maxPrice !== undefined ? ` under $${Number(flags.maxPrice).toFixed(2)}/hr` : '';
    const regionText = flags.region ? ` in ${flags.region}` : '';
    const lines = [
      `No ${gpu} routes found${priceText}${regionText}.`,
      '',
      'Try:',
      `npx gpu-price-finder --gpu ${gpu} --max-price 1`,
      `npx gpu-price-finder --gpu ${gpu} --tier 2`,
      flags.region ? `npx gpu-price-finder --gpu ${gpu} --region ${flags.region}` : 'npx gpu-price-finder',
      ...formatAlternativeLines(alternatives),
      '',
      'Powered by AI Badgr.',
      'Find cheap GPU routes. Run workloads with spend caps.',
      '',
    ];
    return lines.join('\n');
  }

  const lines = [
    'Searching GPU routes...',
    '',
    `Cheapest ${gpu} routes:`,
    '',
  ];
  routes.forEach((route, index) => {
    const status = route.available ? 'available' : 'unavailable';
    lines.push(`${index + 1}. ${route.source}   ${formatPrice(route.price_per_hour)}   Tier ${route.tier}   ${route.region}   ${status}`);
  });

  const best = routes[0];
  lines.push(
    '',
    'Recommendation',
    'Use:',
    '',
    `badgr run "<your-command>" --gpu ${best.gpu} --tier ${best.tier} --max-price ${best.price_per_hour.toFixed(2)} --max-runtime 60`,
    '',
    'Powered by AI Badgr.',
    'Find cheap GPU routes. Run workloads with spend caps.',
    '',
  );
  return lines.join('\n');
}

export function helpText() {
  return [
    'Powered by AI Badgr.',
    'Find cheap GPU routes. Run workloads with spend caps.',
    '',
    'Usage:',
    '  npx gpu-price-finder',
    '  npx gpu-price-finder --gpu RTX_4090 [flags]',
    '',
    'Default (no --gpu):',
    `  Shows top ${OVERVIEW_ROUTES_PER_GPU} routes each for ${OVERVIEW_GPUS.join(', ')}`,
    '',
    'Detailed (--gpu):',
    `  Shows top ${DETAILED_DEFAULT_LIMIT} routes for one GPU with tier, region, and availability`,
    '',
    'Search flags:',
    '  --gpu <type>          Drill into one GPU type',
    '  --region US|EU|AU     Region filter',
    '  --max-price <usd>     Max hourly price filter',
    '  --tier 1|2            Route tier (1 = managed, 2 = lower cost)',
    '  --sort price          Sort order (price only today)',
    '  --limit 1-50          Max routes in detailed mode (default: 5)',
    '  --available-only      Hide unavailable routes',
    '',
    'Output flags:',
    '  --json                Print JSON',
    '  --full                Print JSON with alternatives and requested filters (detailed mode)',
    '  -h, --help            Show this help',
    '',
    'Examples:',
    '  npx gpu-price-finder',
    '  npx gpu-price-finder --gpu RTX_4090 --max-price 1',
    '  npx gpu-price-finder --gpu H100 --region EU --tier 2',
    '',
    `GitHub: ${GITHUB_URL}`,
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(helpText());
    return;
  }

  if (isOverviewMode(flags)) {
    const overview = await fetchOverview(flags);
    if (flags.json || flags.full) {
      console.log(JSON.stringify(overview, null, 2));
      return;
    }
    console.log(formatOverviewOutput(overview));
    return;
  }

  const detailed = resolveDetailedFlags(flags);
  const result = await fetchSearch(detailed);
  if (flags.full) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(result.routes, null, 2));
    return;
  }
  console.log(formatTextOutput(result.routes, detailed, result.alternatives));
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
