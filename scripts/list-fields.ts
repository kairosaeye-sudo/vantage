/**
 * List every field config that exists, with its built data if present.
 * Usage: npx tsx scripts/list-fields.ts
 */
import { listConfigs } from '../lib/field-config';
import { loadField } from '../lib/field-store';

const configs = listConfigs();

if (configs.length === 0) {
  console.log('\nNo field configs found in ./fields\n');
  console.log('Create one:');
  console.log('  npx tsx scripts/build-field.ts --industry "Plumbers" --location "Austin, TX" \\');
  console.log('      --sites plumbers.txt --save-config\n');
  process.exit(0);
}

console.log('\nFIELDS\n' + '═'.repeat(74));
console.log(`${'SLUG'.padEnd(30)} ${'INDUSTRY'.padEnd(14)} ${'LOCATION'.padEnd(16)} ${'SITES'.padStart(5)}  BUILT`);
console.log('─'.repeat(74));

for (const c of configs) {
  const field = loadField(c.slug);
  const built = field ? `${field.siteCount} scored, avg ${field.overall.avg}` : 'not built';
  console.log(
    `${c.slug.padEnd(30)} ${c.industry.slice(0, 13).padEnd(14)} ${c.location.slice(0, 15).padEnd(16)} ${String(c.sites.length).padStart(5)}  ${built}`
  );
}
console.log('═'.repeat(74) + '\n');
