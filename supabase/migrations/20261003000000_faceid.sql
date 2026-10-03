-- Face ID schema. Every row belongs to the signed-in user (owner_id = auth.uid()) and row-level
-- security keeps users' data apart. Face embeddings are stored only as Fernet ciphertext produced
-- by the app server (FACEID_ENCRYPTION_KEY); this database never sees plaintext vectors.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the dashboard's SQL editor.

create table public.face_people (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- When the enrolled person last confirmed consent (enrollment or re-enrollment).
  consent_at  timestamptz not null default now(),
  unique (id, owner_id)
);
create index face_people_owner on public.face_people (owner_id);

create table public.face_embeddings (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  person_id   bigint not null,
  model_id    text not null,
  -- Fernet token (base64 text) of a little-endian float32 vector.
  ciphertext  text not null check (char_length(ciphertext) < 4096),
  -- The composite key makes it impossible to attach an embedding to another user's person.
  foreign key (person_id, owner_id) references public.face_people (id, owner_id) on delete cascade
);
create index face_embeddings_owner on public.face_embeddings (owner_id, model_id);
create index face_embeddings_person on public.face_embeddings (person_id);

create table public.face_events (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at          timestamptz not null default now(),
  person_id   bigint,  -- null = unknown face
  similarity  real check (similarity between 0 and 1),
  foreign key (person_id, owner_id) references public.face_people (id, owner_id) on delete cascade
);
create index face_events_owner_at on public.face_events (owner_id, at desc);

create table public.face_settings (
  owner_id                   uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  recognition_threshold      real    not null default 0.50 check (recognition_threshold between 0.20 and 0.95),
  min_face_size              integer not null default 48   check (min_face_size between 20 and 400),
  detection_score_threshold  real    not null default 0.80 check (detection_score_threshold between 0.30 and 0.99),
  enrollment_samples         integer not null default 15   check (enrollment_samples between 5 and 40),
  event_cooldown_seconds     real    not null default 10   check (event_cooldown_seconds between 0 and 3600),
  log_unknown_faces          boolean not null default true,
  updated_at                 timestamptz not null default now()
);

-- Row-level security: each user sees and changes only their own rows.
alter table public.face_people     enable row level security;
alter table public.face_embeddings enable row level security;
alter table public.face_events     enable row level security;
alter table public.face_settings   enable row level security;

create policy "own people" on public.face_people
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own embeddings" on public.face_embeddings
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own events" on public.face_events
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own settings" on public.face_settings
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.face_people, public.face_embeddings, public.face_events, public.face_settings to authenticated;
revoke all on public.face_people, public.face_embeddings, public.face_events, public.face_settings from anon;

-- Replace a person's embeddings in one transaction (re-enrollment). Runs with the caller's
-- rights, so row-level security still applies.
create function public.face_replace_embeddings(p_person_id bigint, p_model_id text, p_ciphertexts text[], p_name text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.face_people
     set updated_at = now(), consent_at = now(), name = coalesce(nullif(btrim(p_name), ''), name)
   where id = p_person_id;
  if not found then
    raise exception 'Person % not found', p_person_id using errcode = 'P0002';
  end if;
  delete from public.face_embeddings where person_id = p_person_id;
  insert into public.face_embeddings (person_id, model_id, ciphertext)
  select p_person_id, p_model_id, c from unnest(p_ciphertexts) as c;
end;
$$;

-- Create a person with their embeddings in one transaction (enrollment).
create function public.face_enroll_person(p_name text, p_model_id text, p_ciphertexts text[])
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id bigint;
begin
  insert into public.face_people (name) values (btrim(p_name)) returning id into new_id;
  insert into public.face_embeddings (person_id, model_id, ciphertext)
  select new_id, p_model_id, c from unnest(p_ciphertexts) as c;
  return new_id;
end;
$$;

revoke execute on function public.face_replace_embeddings(bigint, text, text[], text) from public, anon;
revoke execute on function public.face_enroll_person(text, text, text[]) from public, anon;
grant execute on function public.face_replace_embeddings(bigint, text, text[], text) to authenticated;
grant execute on function public.face_enroll_person(text, text, text[]) to authenticated;

-- One row per person for the People page. security_invoker makes the view apply the caller's
-- row-level security instead of the view owner's.
create view public.face_people_summary with (security_invoker = true) as
select p.id,
       p.name,
       p.created_at,
       p.updated_at,
       (select count(*) from public.face_embeddings e where e.person_id = p.id) as samples,
       (select coalesce(array_agg(distinct e.model_id), '{}') from public.face_embeddings e where e.person_id = p.id) as model_ids,
       (select max(v.at) from public.face_events v where v.person_id = p.id) as last_seen
  from public.face_people p;

revoke all on public.face_people_summary from anon;
grant select on public.face_people_summary to authenticated;
