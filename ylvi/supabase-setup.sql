-- =========================================================
-- Ylvis Klo-Plan – Einrichtung der Supabase-Datenbank
-- Einmal komplett in Supabase unter "SQL Editor" einfügen und "Run" drücken.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.
-- =========================================================

-- 1) Tabelle für die Einträge
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  time        timestamptz not null,
  type        text not null check (type in ('pipi', 'kacka', 'beides')),
  note        text not null default '' check (char_length(note) <= 500),
  photo_path  text,
  author      text not null default '',
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists entries_time_idx on public.entries (time desc);

-- 2) Zugriff nur für angemeldete Personen (Row Level Security)
alter table public.entries enable row level security;

drop policy if exists "Angemeldete lesen"     on public.entries;
drop policy if exists "Angemeldete schreiben" on public.entries;
drop policy if exists "Angemeldete ändern"    on public.entries;
drop policy if exists "Angemeldete löschen"   on public.entries;

create policy "Angemeldete lesen"     on public.entries for select to authenticated using (true);
create policy "Angemeldete schreiben" on public.entries for insert to authenticated with check (true);
create policy "Angemeldete ändern"    on public.entries for update to authenticated using (true) with check (true);
create policy "Angemeldete löschen"   on public.entries for delete to authenticated using (true);

-- 3) Live-Aktualisierung: neue Einträge erscheinen sofort auf dem anderen Handy
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end $$;

-- 3b) Medikation (Dosisänderungen, z. B. Fluoxetin)
create table if not exists public.medications (
  id          text primary key,
  name        text not null,
  dose_mg     numeric not null check (dose_mg >= 0),
  start_date  date,                       -- leer = seit Beginn der Aufzeichnung
  note        text not null default '' check (char_length(note) <= 300),
  author      text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.medications enable row level security;

drop policy if exists "Angemeldete lesen Medikation"     on public.medications;
drop policy if exists "Angemeldete schreiben Medikation" on public.medications;
drop policy if exists "Angemeldete ändern Medikation"    on public.medications;
drop policy if exists "Angemeldete löschen Medikation"   on public.medications;

create policy "Angemeldete lesen Medikation"     on public.medications for select to authenticated using (true);
create policy "Angemeldete schreiben Medikation" on public.medications for insert to authenticated with check (true);
create policy "Angemeldete ändern Medikation"    on public.medications for update to authenticated using (true) with check (true);
create policy "Angemeldete löschen Medikation"   on public.medications for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'medications'
  ) then
    alter publication supabase_realtime add table public.medications;
  end if;
end $$;

-- 4) Privater Speicher für die Beweisfotos (max. 10 MB pro Foto, nur Bilder)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Fotos lesen"     on storage.objects;
drop policy if exists "Fotos hochladen" on storage.objects;
drop policy if exists "Fotos ändern"    on storage.objects;
drop policy if exists "Fotos löschen"   on storage.objects;

create policy "Fotos lesen"     on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "Fotos hochladen" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "Fotos ändern"    on storage.objects for update to authenticated using (bucket_id = 'photos');
create policy "Fotos löschen"   on storage.objects for delete to authenticated using (bucket_id = 'photos');
