import { readFileSync } from 'fs';
import { fetchSite } from '../lib/fetch-site';
import * as cheerio from 'cheerio';

function loadEnv(): void {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  dentists: ['dentist', 'dental', 'teeth', 'orthodontist', 'oral', 'cavity', 'filling', 'crown', 'veneer', 'whitening', 'root canal', 'extraction'],
};

async function main() {
  loadEnv();
  const { html } = await fetchSite('https://www.roto-rooter.com/');
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').toLowerCase();
  console.log('--- dentists keyword hits ---');
  for (const kw of INDUSTRY_KEYWORDS.dentists) {
    if (text.includes(kw)) console.log(`  MATCH: "${kw}"`);
  }
  console.log('--- location part hits (field = "Boulder, CO") ---');
  for (const part of 'boulder, co'.split(/[,\s]+/).filter(Boolean)) {
    console.log(`  "${part}" includes? ${text.includes(part)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
