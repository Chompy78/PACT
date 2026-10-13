// Turns a dump from `node testing/scripts/dm-campaign-house-rules-e2e.mjs --dump-calls <file>` into SQL that replays every
// change the DM Console sent — dm_apply_house_rules_change(rules, actions) and the dm_edit_character_log calls after it —
// against the REAL migration, as the campaign's DM, then records the server's AP left for every character next to the
// AP left the engine (and so every tool) shows. Used by run-dm-house-rules-replay.sh; prints SQL on stdout.
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const q = v => "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
const DM = 'd0000000-0000-0000-0000-000000000001';
const owner = i => 'a0000000-0000-0000-0000-0000000000' + String(i + 1).padStart(2, '0');
let out = `\\set ON_ERROR_STOP on
drop table if exists rr; create table rr(scn int, name text, locked boolean, server numeric, browser numeric);
create or replace function as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create or replace function as_admin() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
`;
d.scenarios.forEach((s, n) => {
  out += `\n-- scenario ${n + 1}: ${s.actions.length} action(s), ${s.dmEdits.length} dm_edit_character_log call(s)\n`;
  out += `begin;\nselect as_admin();\ntruncate characters, character_backups, campaign_dms, campaigns cascade;\n`;
  out += `insert into campaigns(id, dm_id, name, ignore_player_ap, rules) values ('${d.campaign}', '${DM}', 'Replay', false, ${q(s.rules0)});\n`;
  s.chars0.forEach((c, i) => {
    out += `insert into characters(id, owner_id, campaign_id, name, kind, ap, stats) values ('${c.id}', '${owner(i)}', '${d.campaign}', ${"'" + c.name.replace(/'/g, "''") + "'"}, 'livesheet', ${Number(c.ap) || 0}, ${q({ SEQ: c.LOG.length + 1, LOG: c.LOG })});\n`;
  });
  out += `select as_user('${DM}');\nselect dm_apply_house_rules_change('${d.campaign}', ${s.chr == null ? 'null' : q(s.chr)}, ${q(s.actions)}) is not null as applied;\n`;
  s.dmEdits.forEach(e => { out += `select jsonb_array_length(dm_edit_character_log('${e.character}', ${q(e.events)})) as dm_edited;\n`; });
  out += `select as_admin();\n`;
  s.expect.forEach(x => {
    out += `insert into rr select ${n + 1}, c.name, (c.stats->'LOG') @> '[{"type":"creationLocked"}]'::jsonb,
  c.ap + (case when cp.ignore_player_ap then 0 else sp.award_earned end)
       + coalesce(least(public.pact_hr_drawback_cap(cp.rules), sp.drawback_earned), sp.drawback_earned) - sp.spent, ${Number(x.apLeft)}
  from characters c join campaigns cp on cp.id = c.campaign_id, lateral public.pact_ap_ledger_split(c.stats->'LOG', cp.rules->'charHouseRules', c.campaign_id) sp
  where c.id = '${x.id}';\n`;
  });
  out += `commit;\n`;
});
process.stdout.write(out);
