import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildSearchUrl,
  DETAILED_DEFAULT_LIMIT,
  fetchOverview,
  formatOverviewOutput,
  formatTextOutput,
  isCliEntry,
  isOverviewMode,
  normalizeAlternatives,
  normalizeBaseUrl,
  normalizeRoutes,
  OVERVIEW_GPUS,
  OVERVIEW_ROUTES_PER_GPU,
  parseArgs,
  resolveDetailedFlags,
  routeLabel,
} from '../src/cli.js';

describe('gpu-price-finder CLI', () => {
  it('defaults to overview mode with no --gpu', () => {
    expect(parseArgs([])).toEqual({
      gpu: undefined,
      sort: 'price',
      limit: undefined,
      json: false,
      full: false,
      availableOnly: false,
    });
    expect(isOverviewMode(parseArgs([]))).toBe(true);
  });

  it('enters detailed mode when --gpu is provided', () => {
    const flags = parseArgs(['--gpu', 'RTX_4090']);
    expect(flags.gpu).toBe('RTX_4090');
    expect(isOverviewMode(flags)).toBe(false);
    expect(resolveDetailedFlags(flags).limit).toBe(DETAILED_DEFAULT_LIMIT);
  });

  it('labels masked routes as Route A, Route B, Route C', () => {
    expect(routeLabel(0)).toBe('Route A');
    expect(routeLabel(1)).toBe('Route B');
    expect(routeLabel(2)).toBe('Route C');
  });

  it('redirects legacy api.aibadgr.com base URL to aibadgr.com', () => {
    expect(normalizeBaseUrl('https://api.aibadgr.com/v1')).toBe('https://aibadgr.com/v1');
  });

  it('detects CLI entry through npm bin symlinks', () => {
    const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
    const originalArgv = process.argv[1];
    process.argv[1] = cliPath;
    expect(isCliEntry()).toBe(true);
    process.argv[1] = `${cliPath}-not-real`;
    expect(isCliEntry()).toBe(false);
    process.argv[1] = originalArgv;
    expect(realpathSync(cliPath)).toBe(realpathSync(cliPath));
  });

  it('parses filters and builds the public search URL', () => {
    const flags = parseArgs(['--gpu', 'rtx-4090', '--region', 'us', '--max-price', '1', '--tier', '2', '--limit', '3', '--json']);
    const url = buildSearchUrl(flags, 'https://aibadgr.com/v1');
    expect(url.toString()).toBe('https://aibadgr.com/v1/capacity/search?gpu=RTX_4090&sort=price&limit=3&region=US&max_price=1&tier=2');
    expect(flags.json).toBe(true);
  });

  it('normalizes route data without leaking internal identifiers', () => {
    const routes = normalizeRoutes({
      routes: [
        { source: 'ignored', tier: 2, gpu: 'RTX_4090', price_per_hour: 0.61, region: 'US', available: true, internal_id: 'hidden' },
        { tier: 1, gpu: 'RTX_4090', price: 0.42, region: 'EU' },
      ],
    }, resolveDetailedFlags(parseArgs(['--gpu', 'RTX_4090'])));

    expect(routes).toEqual([
      { source: 'Route A', tier: 1, gpu: 'RTX_4090', price_per_hour: 0.42, region: 'EU', available: true },
      { source: 'Route B', tier: 2, gpu: 'RTX_4090', price_per_hour: 0.61, region: 'US', available: true },
    ]);
    expect(JSON.stringify(routes)).not.toContain('hidden');
  });

  it('formats overview output for the default npx experience', () => {
    const output = formatOverviewOutput([
      {
        gpu: 'RTX_4090',
        routes: [
          { source: 'Route A', price_per_hour: 0.17 },
          { source: 'Route B', price_per_hour: 0.25 },
        ],
      },
      {
        gpu: 'L40S',
        routes: [
          { source: 'Route A', price_per_hour: 0.39 },
          { source: 'Route B', price_per_hour: 0.44 },
        ],
      },
      {
        gpu: 'A100',
        routes: [
          { source: 'Route A', price_per_hour: 0.89 },
          { source: 'Route B', price_per_hour: 1.12 },
        ],
      },
    ]);

    expect(output).toContain('Searching GPU routes...');
    expect(output).toContain('Cheapest routes right now:');
    expect(output).toContain('RTX_4090');
    expect(output).toContain('  Route A   $0.17/hr');
    expect(output).toContain('  Route B   $0.25/hr');
    expect(output).toContain('L40S');
    expect(output).toContain('A100');
    expect(output).toContain('Drill down:');
    expect(output).toContain('npx gpu-price-finder --gpu RTX_4090');
    expect(output).not.toContain('Tier');
  });

  it('prints detailed output with tier, region, and availability', () => {
    const output = formatTextOutput([
      { source: 'Route A', tier: 2, gpu: 'RTX_4090', price_per_hour: 0.42, region: 'US', available: true },
    ], parseArgs(['--gpu', 'RTX_4090']));
    expect(output).toContain('Searching GPU routes...');
    expect(output).toContain('Cheapest RTX_4090 routes:');
    expect(output).toContain('1. Route A   $0.42/hr   Tier 2   US   available');
    expect(output).toContain('Recommendation');
    expect(output).toContain('badgr run');
    expect(output).not.toContain('badgr login');
  });

  it('no-results detailed output includes alternatives and retry hints', () => {
    const output = formatTextOutput([], parseArgs(['--gpu', 'H100', '--max-price', '2']), [
      { gpu: 'L40S', region: 'US', price_per_hour: 0.33, diff_desc: 'less VRAM than H100' },
    ]);
    expect(output).toContain('No H100 routes found under $2.00/hr.');
    expect(output).toContain('npx gpu-price-finder');
    expect(output).toContain('Available alternatives:');
    expect(output).toContain('L40S');
  });

  it('normalizes alternatives without leaking provider details', () => {
    const alternatives = normalizeAlternatives({
      alternatives: [
        { gpu: 'l40s', region: 'us', price: 0.33, diff_desc: 'less VRAM', provider: 'hidden' },
      ],
    });
    expect(alternatives).toEqual([
      { gpu: 'L40S', region: 'US', price_per_hour: 0.33, diff_desc: 'less VRAM' },
    ]);
    expect(JSON.stringify(alternatives)).not.toContain('hidden');
  });
});

describe('gpu-price-finder scenario: P1 — API completely unreachable', () => {
  it('throws when overview fetch rejects (network down)', async () => {
    const { fetchOverview } = await import('../src/cli.js');
    const deadFetch = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(fetchOverview(parseArgs([]), deadFetch)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('gpu-price-finder scenario: P2 — API returns 5xx error', () => {
  it('throws with HTTP status included in the message', async () => {
    const { fetchRoutes } = await import('../src/cli.js');
    const errorFetch = () =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => JSON.stringify({ message: 'capacity search unavailable' }),
      });
    await expect(fetchRoutes(parseArgs(['--gpu', 'RTX_4090']), errorFetch)).rejects.toThrow('HTTP 503');
  });
});

describe('gpu-price-finder scenario: P3 — partial results or empty response', () => {
  it('filters out zero-dollar routes from the API', () => {
    const flags = resolveDetailedFlags(parseArgs(['--gpu', 'L40S']));
    const routes = normalizeRoutes({
      routes: [
        { tier: 1, gpu: 'L40S', price_per_hour: 0, region: 'US', available: true },
        { tier: 1, gpu: 'L40S', price_per_hour: 0.89, region: 'US', available: true },
      ],
    }, flags);
    expect(routes).toHaveLength(1);
    expect(routes[0].price_per_hour).toBe(0.89);
  });

  it('returns empty array when API responds with empty routes list', async () => {
    const { fetchRoutes } = await import('../src/cli.js');
    const emptyFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ routes: [] }),
      });
    const routes = await fetchRoutes(parseArgs(['--gpu', 'H100']), emptyFetch);
    expect(routes).toEqual([]);
  });

  it('overview fetch returns top routes for each overview GPU', async () => {
    const responses = {
      RTX_4090: [{ price_per_hour: 0.17, tier: 2, region: 'US' }, { price_per_hour: 0.25, tier: 2, region: 'US' }],
      L40S: [{ price_per_hour: 0.39, tier: 1, region: 'US' }],
      A100: [{ price_per_hour: 0.89, tier: 1, region: 'US' }, { price_per_hour: 1.12, tier: 1, region: 'EU' }],
    };
    const mockFetch = (url) => {
      const gpu = new URL(url).searchParams.get('gpu');
      const limit = Number(new URL(url).searchParams.get('limit'));
      expect(limit).toBe(OVERVIEW_ROUTES_PER_GPU);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ routes: responses[gpu] || [] }),
      });
    };

    const overview = await fetchOverview(parseArgs([]), mockFetch);
    expect(overview).toHaveLength(OVERVIEW_GPUS.length);
    expect(overview[0].gpu).toBe('RTX_4090');
    expect(overview[0].routes).toHaveLength(2);
    expect(overview[1].gpu).toBe('L40S');
    expect(overview[2].gpu).toBe('A100');
  });

  it('respects --limit in detailed mode', () => {
    const flags = resolveDetailedFlags(parseArgs(['--gpu', 'RTX_4090', '--limit', '2']));
    const routes = normalizeRoutes({
      routes: [
        { price_per_hour: 0.90, tier: 1, region: 'US' },
        { price_per_hour: 0.60, tier: 2, region: 'EU' },
        { price_per_hour: 0.45, tier: 1, region: 'AP' },
      ],
    }, flags);
    expect(routes).toHaveLength(2);
    expect(routes[0].price_per_hour).toBe(0.45);
  });
});

describe('gpu-price-finder scenario: P4 — minor input edge cases', () => {
  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown flag: --unknown');
  });

  it('rejects invalid --region values', () => {
    expect(() => parseArgs(['--region', 'APAC'])).toThrow('--region must be US, EU, or AU');
  });

  it('parses --full and --available-only boolean flags', () => {
    expect(parseArgs(['--full', '--available-only', '--gpu', 'A100'])).toMatchObject({
      full: true,
      availableOnly: true,
      gpu: 'A100',
    });
  });
});

describe('gpu-price-finder scenario: e2e — full fetch + format pipeline', () => {
  it('returns masked, sorted, formatted routes from a realistic API response', async () => {
    const { fetchRoutes } = await import('../src/cli.js');
    const mockFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            routes: [
              { source: 'internal-offer-42', tier: 2, gpu: 'RTX_4090', price_per_hour: 0.86, region: 'US', available: true, internal_id: 'secret' },
              { source: 'internal-offer-7', tier: 1, gpu: 'RTX_4090', price_per_hour: 0.53, region: 'EU', available: true, host_id: 'sensitive' },
            ],
          }),
      });
    const flags = parseArgs(['--gpu', 'RTX_4090', '--max-price', '1']);
    const routes = await fetchRoutes(flags, mockFetch);

    expect(routes).toHaveLength(2);
    expect(routes[0].source).toBe('Route A');
    expect(routes[0].price_per_hour).toBe(0.53);

    const text = formatTextOutput(routes, resolveDetailedFlags(flags));
    expect(text).toContain('Cheapest RTX_4090 routes:');
    expect(text).toContain('Route A');
    expect(text).toContain('$0.53/hr');
    expect(JSON.stringify(routes)).not.toContain('internal-offer');
    expect(JSON.stringify(routes)).not.toContain('secret');
    expect(JSON.stringify(routes)).not.toContain('sensitive');
  });
});
