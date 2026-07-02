-- PACT — REV-07: source invite codes from a CSPRNG, not random()
--
-- gen_invite_code() built each of its 6 characters from random()*36 -- Postgres's
-- plain PRNG, not cryptographically secure. Invite codes function as shared
-- secrets (they gate join_campaign / join_as_dm), so they should come from
-- pgcrypto's gen_random_bytes() instead. pgcrypto is already enabled
-- (schema.sql's gen_random_uuid()).
--
-- Six random bytes are pulled per candidate code, one per character, each
-- reduced mod 36 onto the existing A-Z0-9 alphabet. This keeps the code length
-- and the campaigns table's `^[A-Z0-9]{6}$` check regex unchanged -- only the
-- entropy source changes. (256 isn't a multiple of 36, so there's a small bias
-- toward earlier alphabet characters; negligible for a 6-char invite code and
-- not worth the extra complexity of rejection sampling here.)

create or replace function public.gen_invite_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  raw  bytea;
begin
  loop
    raw := gen_random_bytes(6);
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(raw, i) % 36), 1);
    end loop;
    exit when not exists (
      select 1 from public.campaigns where invite_code = code or dm_invite_code = code
    );
  end loop;
  return code;
end;
$$;
