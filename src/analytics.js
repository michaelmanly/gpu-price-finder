import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json');

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const DEFAULT_POSTHOG_KEY = 'phc_ikoQL8xnooFmHivijgwygh8CXlvZibFeDztqpZ6bqCe';
const ANALYTICS_ID_DIR = join(homedir(), '.gpu-price-finder');
const ANALYTICS_ID_FILE = join(ANALYTICS_ID_DIR, 'analytics-id');
const FLUSH_TIMEOUT_MS = 2_000;

export function isAnalyticsEnabled(env = process.env) {
  if (env.POSTHOG_DISABLED === '1') return false;
  if (env.NODE_ENV === 'test') return false;
  return Boolean(env.POSTHOG_API_KEY || DEFAULT_POSTHOG_KEY);
}

export function resolvePostHogConfig(env = process.env) {
  return {
    apiKey: env.POSTHOG_API_KEY || DEFAULT_POSTHOG_KEY,
    host: String(env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST).replace(/\/+$/, ''),
  };
}

export async function getDistinctId(fsImpl = { readFile, writeFile, mkdir }) {
  try {
    const existing = await fsImpl.readFile(ANALYTICS_ID_FILE, 'utf8');
    if (existing.trim()) return existing.trim();
  } catch {
    // first run
  }

  const distinctId = randomUUID();
  try {
    await fsImpl.mkdir(ANALYTICS_ID_DIR, { recursive: true });
    await fsImpl.writeFile(ANALYTICS_ID_FILE, distinctId, 'utf8');
  } catch {
    // still send events with an ephemeral id
  }
  return distinctId;
}

export function createAnalytics(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const enabled = options.enabled ?? isAnalyticsEnabled(env);
  const config = resolvePostHogConfig(env);
  const queue = [];
  let distinctIdPromise;

  function track(event, properties = {}) {
    if (!enabled) return;
    queue.push({
      event,
      properties: {
        ...properties,
        $lib: 'gpu-price-finder',
        source: 'cli',
        package_version: PACKAGE_VERSION,
      },
    });
  }

  async function flush() {
    if (!enabled || queue.length === 0) return;

    if (!distinctIdPromise) {
      distinctIdPromise = getDistinctId(options.fsImpl);
    }
    const distinctId = await distinctIdPromise;

    const events = queue.splice(0, queue.length);
    await Promise.allSettled(events.map(async ({ event, properties }) => {
      try {
        await fetchImpl(`${config.host}/capture/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: config.apiKey,
            event,
            distinct_id: distinctId,
            properties,
          }),
          signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        });
      } catch {
        // analytics must never affect CLI behavior
      }
    }));
  }

  return { track, flush, enabled };
}

export function searchContext(flags) {
  return {
    gpu: flags.gpu,
    region: flags.region,
    tier: flags.tier,
    max_price: flags.maxPrice,
    json: flags.json,
    full: flags.full,
    available_only: flags.availableOnly,
  };
}
