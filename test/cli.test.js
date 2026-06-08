import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSearchUrl, formatTextOutput, isCliEntry, normalizeBaseUrl, normalizeRoutes, parseArgs } from '../src/cli.js';

describe('gpu-price-finder CLI', () => {
  it('defaults to RTX_4090 sorted by price with limit 5', () => {
    expect(parseArgs([])).toEqual({ gpu: 'RTX_4090', sort: 'price', limit: 5, json: false });
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
    }, parseArgs(['--gpu', 'RTX_4090']));

    expect(routes).toEqual([
      { source: 'Source 1', tier: 1, gpu: 'RTX_4090', price_per_hour: 0.42, region: 'EU', available: true },
      { source: 'Source 2', tier: 2, gpu: 'RTX_4090', price_per_hour: 0.61, region: 'US', available: true },
    ]);
    expect(JSON.stringify(routes)).not.toContain('hidden');
  });

  it('prints Recommendation section with gpu-price-finder command and tagline', () => {
    const output = formatTextOutput([
      { source: 'Source 1', tier: 2, gpu: 'RTX_4090', price_per_hour: 0.42, region: 'US', available: true },
    ], parseArgs(['--gpu', 'RTX_4090']));
    expect(output).toContain('Cheapest RTX_4090 routes:');
    expect(output).toContain('Recommendation');
    expect(output).toContain('Use:');
    expect(output).toContain('npx gpu-price-finder --gpu RTX_4090 --max-price 1');
    expect(output).toContain('Powered by AI Badgr.');
    expect(output).toContain('Find cheap GPU routes. Run workloads with spend caps.');
    expect(output).not.toContain('badgr login');
  });

  it('no-results output includes gpu-price-finder try commands and tagline', () => {
    const output = formatTextOutput([], parseArgs(['--gpu', 'H100', '--max-price', '2']));
    expect(output).toContain('No H100 routes found under $2.00/hr.');
    expect(output).toContain('npx gpu-price-finder --gpu H100 --max-price 1');
    expect(output).toContain('npx gpu-price-finder --gpu H100 --tier 2');
    expect(output).toContain('Powered by AI Badgr.');
    expect(output).toContain('Find cheap GPU routes. Run workloads with spend caps.');
  });
});

// ---------------------------------------------------------------------------
// Scenario tests — P1 / P2 / P3 / P4 / e2e
// ---------------------------------------------------------------------------

describe('gpu-price-finder scenario: P1 — API completely unreachable', () => {
  it('throws with a clear message when fetch rejects (network down)', async () => {
    const { fetchRoutes } = await import('../src/cli.js');
    const deadFetch = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(fetchRoutes(parseArgs([]), deadFetch)).rejects.toThrow('ECONNREFUSED');
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
    await expect(fetchRoutes(parseArgs([]), errorFetch)).rejects.toThrow('HTTP 503');
  });

  it('throws even when error body is not valid JSON', async () => {
    const { fetchRoutes } = await import('../src/cli.js');
    const errorFetch = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'not json',
      });
    await expect(fetchRoutes(parseArgs([]), errorFetch)).rejects.toThrow('HTTP 500');
  });
});

describe('gpu-price-finder scenario: P3 — partial results or empty response', () => {
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

  it('filters out routes with missing or invalid prices', () => {
    const flags = parseArgs(['--gpu', 'RTX_4090']);
    const routes = normalizeRoutes({
      routes: [
        { tier: 1, gpu: 'RTX_4090', region: 'US' },
        { tier: 2, gpu: 'RTX_4090', price_per_hour: 0.75, region: 'EU', available: true },
        { tier: 1, gpu: 'RTX_4090', price: null, region: 'US' },
      ],
    }, flags);
    expect(routes).toHaveLength(1);
    expect(routes[0].price_per_hour).toBe(0.75);
  });

  it('respects --limit even when more routes are returned', () => {
    const flags = parseArgs(['--gpu', 'RTX_4090', '--limit', '2']);
    const routes = normalizeRoutes({
      routes: [
        { price_per_hour: 0.90, tier: 1, region: 'US' },
        { price_per_hour: 0.60, tier: 2, region: 'EU' },
        { price_per_hour: 0.45, tier: 1, region: 'AP' },
        { price_per_hour: 1.20, tier: 2, region: 'US' },
      ],
    }, flags);
    expect(routes).toHaveLength(2);
    expect(routes[0].price_per_hour).toBe(0.45);
    expect(routes[1].price_per_hour).toBe(0.60);
  });
});

describe('gpu-price-finder scenario: P4 — minor input edge cases', () => {
  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown flag: --unknown');
  });

  it('rejects flag with missing value', () => {
    expect(() => parseArgs(['--gpu'])).toThrow('Missing value for --gpu');
  });

  it('rejects invalid --tier values', () => {
    expect(() => parseArgs(['--tier', '3'])).toThrow('--tier must be 1 or 2');
  });

  it('rejects negative --max-price', () => {
    expect(() => parseArgs(['--max-price', '-5'])).toThrow('--max-price must be a non-negative number');
  });

  it('rejects --limit out of range', () => {
    expect(() => parseArgs(['--limit', '0'])).toThrow('--limit must be an integer from 1 to 50');
    expect(() => parseArgs(['--limit', '51'])).toThrow('--limit must be an integer from 1 to 50');
  });

  it('normalizes GPU names with dashes to underscores', () => {
    expect(parseArgs(['--gpu', 'rtx-4090']).gpu).toBe('RTX_4090');
    expect(parseArgs(['--gpu', 'h100']).gpu).toBe('H100');
  });

  it('zero --max-price is accepted (free routes filter)', () => {
    expect(parseArgs(['--max-price', '0']).maxPrice).toBe(0);
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
              { source: 'internal-offer-7',  tier: 1, gpu: 'RTX_4090', price_per_hour: 0.53, region: 'EU', available: true, host_id: 'sensitive' },
            ],
          }),
      });
    const flags = parseArgs(['--gpu', 'RTX_4090', '--max-price', '1']);
    const routes = await fetchRoutes(flags, mockFetch);

    expect(routes).toHaveLength(2);
    expect(routes[0].source).toBe('Source 1');
    expect(routes[0].price_per_hour).toBe(0.53);
    expect(routes[1].source).toBe('Source 2');
    expect(routes[1].price_per_hour).toBe(0.86);

    const serialized = JSON.stringify(routes);
    expect(serialized).not.toContain('internal-offer');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('sensitive');

    const text = formatTextOutput(routes, flags);
    expect(text).toContain('Cheapest RTX_4090 routes:');
    expect(text).toContain('Source 1');
    expect(text).toContain('$0.53/hr');
    expect(text).toContain('Recommendation');
    expect(text).toContain('npx gpu-price-finder --gpu RTX_4090 --max-price 1');
    expect(text).toContain('Powered by AI Badgr.');
    expect(text).toContain('Find cheap GPU routes. Run workloads with spend caps.');
  });

  it('e2e no-results path shows tagline', async () => {
    const { fetchRoutes } = await import('../src/cli.js');
    const emptyFetch = () =>
      Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify([]) });
    const flags = parseArgs(['--gpu', 'A100', '--max-price', '0.50']);
    const routes = await fetchRoutes(flags, emptyFetch);
    const text = formatTextOutput(routes, flags);
    expect(text).toContain('No A100 routes found under $0.50/hr.');
    expect(text).toContain('npx gpu-price-finder --gpu A100 --max-price 1');
    expect(text).toContain('Powered by AI Badgr.');
    expect(text).toContain('Find cheap GPU routes. Run workloads with spend caps.');
  });
});
