-- CivicRadar Phase 1: civic_actions table + radius RPC.
-- For review only; not applied to any project. Based on docs/BLUEPRINT.md ("Starter Supabase / PostGIS SQL").
-- Changes from the blueprint are marked "CHANGED" or "ADDED".

create extension if not exists postgis with schema extensions;

create table if not exists public.civic_actions (
  id                    bigint generated always as identity primary key,
  meeting_date          date not null,
  municipality          text not null,
  body                  text,
  meeting_type          text,                                         -- ADDED (in the JSON schema, missing from blueprint SQL)
  document_type         text not null check (document_type in ('agenda','packet','minutes','action_agenda')),
  item_number           text,
  item_key              text not null,                                -- ADDED: item_number, or 'title:<normalized title>' when unnumbered (set by the loader)
  case_number           text,
  action_type           text check (action_type in ('Zoning','Infrastructure','Budget','Other')),
  title                 text not null,
  plain_english_summary text,
  addresses             text[] not null default '{}',
  parcel_pins           text[] not null default '{}',
  approval_status       text check (approval_status in ('scheduled','approved','denied','continued','withdrawn','unknown')),
  vote_text             text,
  evidence_quote        text,
  source_url            text not null,
  source_pages          int[] not null default '{}',
  extraction_confidence numeric(3,2) check (extraction_confidence between 0 and 1),
  extraction_model      text,                                         -- ADDED: which model produced the row
  source_doc_sha256     text,                                         -- ADDED: detect re-published documents
  geom                  extensions.geography(Point, 4326),
  geocode_method        text check (geocode_method in ('pin','census','nominatim','manual')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),          -- ADDED
  -- CHANGED: keyed on document_type + item_key instead of (source_url, item_number): unnumbered
  -- items (e.g. closed-session actions) would collide on a null item_number, and Legistar agenda
  -- and minutes share the meeting's source_url.
  constraint civic_actions_source_item_key unique (source_url, document_type, item_key)
);

create index if not exists civic_actions_geom_idx on public.civic_actions using gist (geom);
create index if not exists civic_actions_date_idx on public.civic_actions (meeting_date desc);
create index if not exists civic_actions_case_idx on public.civic_actions (case_number) where case_number is not null;  -- ADDED
create index if not exists civic_actions_pins_idx on public.civic_actions using gin (parcel_pins);                      -- ADDED

-- ADDED: keep updated_at current on upserts.
create or replace function public.civic_actions_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists civic_actions_touch on public.civic_actions;
create trigger civic_actions_touch before update on public.civic_actions
  for each row execute function public.civic_actions_touch();

-- Radius query for the map + alerts (meters; 2 miles ~= 3219 m).
-- CHANGED: security invoker + pinned search_path (Supabase advisor recommendations),
-- and explicit execute grants.
create or replace function public.actions_within(lat double precision, lng double precision, meters int default 3219)
returns setof public.civic_actions
language sql stable security invoker set search_path = ''
as $$
  select * from public.civic_actions
  where geom is not null
    and extensions.st_dwithin(
      geom,
      extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      meters
    )
  order by meeting_date desc;
$$;

revoke all on function public.actions_within(double precision, double precision, int) from public;
grant execute on function public.actions_within(double precision, double precision, int) to anon, authenticated;

alter table public.civic_actions enable row level security;
drop policy if exists "public read" on public.civic_actions;
create policy "public read" on public.civic_actions for select to anon, authenticated using (true);
-- Writes come from the ingest job with the service role key, which bypasses RLS; no write policies.

-- Not in Phase 1 (per scope): alert trigger + jobs queue (blueprint 1e), geocoding columns beyond geom/geocode_method.
