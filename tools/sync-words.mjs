// Regenerates web/words.js (the built-in word list) from data/pippas_power_words.csv.
// Usage: node tools/sync-words.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const csv = readFileSync(new URL('../data/pippas_power_words.csv', import.meta.url), 'utf8');
writeFileSync(new URL('../web/words.js', import.meta.url),
  '// Generated from data/pippas_power_words.csv by tools/sync-words.mjs — edit the CSV, then re-run.\n' +
  'window.HP_BUILTIN_CSV = ' + JSON.stringify(csv) + ';\n');
console.log('web/words.js updated');
