#!/usr/bin/env node
/**
 * campaign-language-note-ci.mjs — a plain language name is listed when the campaign's list entry carries a "(note)"
 * (fix/strict-language-note-match).
 *
 * WHY. Amble's language list is strict and its entries carry notes inside the name: "Haldeni (default)", "Aelvish (Elven dialect)
 * (Elven rule)". campaignLanguages().isListed() was an exact match, so the plain name a player types ("Haldeni") counted as off the list
 * and a strict campaign refused it (found live 2026-10-22; seven characters were hand-edited). Now a name is also listed when it equals
 * a list entry with its TRAILING bracket groups removed. The exact match is unchanged; nothing stored is rewritten.
 *
 * AMBLE is a frozen copy of that campaign's real list (read from the live campaigns table, 2026-10-25) so the cases are the ones that bit.
 *
 * Run:  node testing/scripts/campaign-language-note-ci.mjs     (expect 0 failed; exits non-zero otherwise)
 */
import { campaignLanguages, STANDARD_LANGUAGES } from '../../js/engine.js';

let pass = 0, fail = 0; const bad = [];
const check = (name, ok, d = '') => { ok ? pass++ : (fail++, bad.push(name + (d ? ' — ' + d : ''))); };

const AMBLE = { languages: { strict: true, list: [
  'Haldeni (default)', 'Aelvish (Elven dialect) (Elven rule)', 'Albric (island trading nation)', 'Aurelani (peaceful farming nation)',
  "Reedmeric dialect (1/3 Halden's conquered territories)", "Old Delvern tongue (2/3 Halden's conquered territories)",
  'Kaldrunic (Dwarvish dialect) (Slavery legal)', 'Merchant Pidgin (Albric)', 'Common Sign Language', 'Draconic', 'Dwarvish', 'Elvish',
  'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Deep Speech', 'Druidic', 'Infernal', 'Primordial', 'Sylvan',
  "Thieves' Cant (Albric)", "Thieves' Cant (Aurelani)", "Thieves' Cant (Haldeni)", "Thieves' Cant (Kaldrun)", 'Undercommon'] } };
const amble = campaignLanguages(AMBLE);

// 1. the plain name of every annotated entry is listed
const plain = { 'Haldeni': 'Haldeni (default)', 'Aelvish': 'Aelvish (Elven dialect) (Elven rule)', 'Albric': 'Albric (island trading nation)',
  'Aurelani': 'Aurelani (peaceful farming nation)', 'Reedmeric dialect': "Reedmeric dialect (1/3 Halden's conquered territories)",
  'Old Delvern tongue': "Old Delvern tongue (2/3 Halden's conquered territories)", 'Kaldrunic': 'Kaldrunic (Dwarvish dialect) (Slavery legal)',
  'Merchant Pidgin': 'Merchant Pidgin (Albric)', "Thieves' Cant": "Thieves' Cant (Albric)" };
for (const [p, entry] of Object.entries(plain)) check(`plain "${p}" is listed (entry "${entry}")`, amble.isListed(p) === true);

// 2. every full entry is still listed, exactly as before
for (const e of amble.list) check(`the entry "${e}" itself is still listed`, amble.isListed(e) === true);

// 3. case and spacing are still ignored, on the plain form too
check('"haldeni" (lower case) is listed', amble.isListed('haldeni') === true);
check('"  HALDENI  " (padded, upper case) is listed', amble.isListed('  HALDENI  ') === true);
check('"Merchant   Pidgin" (inner spaces) is listed', amble.isListed('Merchant   Pidgin') === true);

// 4. names that are NOT on the list stay off it
for (const off of ['Common', 'Orcish', 'Elven', 'Elvish (Elven rule)', 'Haldeni (default) (extra)', 'Kaldrun', 'Merchant', 'Pidgin',
                   'Thieves', "Thieves' Cant (Someone Else)", 'Aelvish (Elven dialect)']) {
  check(`"${off}" stays off the list`, amble.isListed(off) === false);
}

// 5. a blank name counts as listed (unchanged), and null/undefined do not throw
check('blank is listed', amble.isListed('') === true && amble.isListed('   ') === true);
check('null / undefined are treated as blank', amble.isListed(null) === true && amble.isListed(undefined) === true);

// 6. only TRAILING bracket groups come off; an entry that is only a note adds nothing
const odd = campaignLanguages({ languages: { strict: true, list: ['Old (x) Tongue', '(just a note)', 'Plain'] } });
check('a bracket in the MIDDLE of an entry is not stripped ("Old" is off the list)', odd.isListed('Old') === false && odd.isListed('Old Tongue') === false);
check('…and the entry itself is listed', odd.isListed('Old (x) Tongue') === true);
check('an entry that is only a note lists nothing extra (blank stays the only free name)', odd.isListed('just a note') === false && odd.isListed('(just a note)') === true);
check('an unannotated entry is unchanged', odd.isListed('Plain') === true && odd.isListed('Plain (note)') === false);

// 7. the list that is OFFERED is untouched (the player still sees the full entries), and the flags are unchanged
check('the offered list is the DM\'s own entries', JSON.stringify(amble.list) === JSON.stringify(AMBLE.languages.list));
check('strict / custom / checked are unchanged', amble.strict === true && amble.custom === true && amble.checked === true);

// 8. the standard list and a campaign with no list behave as before
const std = campaignLanguages(null);
check('no campaign: the standard list, not checked, "Elvish" listed', std.custom === false && std.checked === false && std.isListed('Elvish') === true);
check('no campaign: a made-up name is still off the standard list', std.isListed('Klingon') === false);
check('every standard language is listed', STANDARD_LANGUAGES.every(n => std.isListed(n)));

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed / ${fail} failed`);
if (fail) { bad.forEach(b => console.log('  FAIL ' + b)); process.exit(1); }
