import { readFileSync } from 'fs';
import { detectLocation } from '../lib/location-detect';
import { fetchSite } from '../lib/fetch-site';

function loadEnv(): void {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

async function main(): Promise<void> {
  loadEnv();
  const urls = process.argv.slice(2);
  for (const url of urls) {
    try {
      const { html } = await fetchSite(url);
      const loc = await detectLocation(html);
      console.log(`${url}\n  city=${loc.city} region=${loc.region} source=${loc.source}\n  evidence=${loc.evidence}\n`);
    } catch (e) {
      console.log(`${url}\n  ERROR: ${e instanceof Error ? e.message : e}\n`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
