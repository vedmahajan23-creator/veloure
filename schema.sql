create extension if not exists pgcrypto;

create table if not exists public.templates (
  id text primary key,
  title text not null check (char_length(title) between 1 and 48),
  category text not null,
  description text not null default '' check (char_length(description) <= 90),
  image_path text not null unique,
  image_width integer not null check (image_width > 0),
  image_height integer not null check (image_height > 0),
  slots jsonb not null check (
    jsonb_typeof(slots) = 'array'
    and jsonb_array_length(slots) between 1 and 8
  ),
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.templates enable row level security;

drop policy if exists "Visitors can view published templates" on public.templates;
create policy "Visitors can view published templates"
  on public.templates for select
  using (published or (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

drop policy if exists "Admins can add templates" on public.templates;
create policy "Admins can add templates"
  on public.templates for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

drop policy if exists "Admins can edit templates" on public.templates;
create policy "Admins can edit templates"
  on public.templates for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

drop policy if exists "Admins can remove templates" on public.templates;
create policy "Admins can remove templates"
  on public.templates for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'template-artwork',
  'template-artwork',
  true,
  15728640,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Visitors can view template artwork" on storage.objects;
create policy "Visitors can view template artwork"
  on storage.objects for select
  using (bucket_id = 'template-artwork');

drop policy if exists "Admins can upload template artwork" on storage.objects;
create policy "Admins can upload template artwork"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'template-artwork'
    and (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
  );

drop policy if exists "Admins can update template artwork" on storage.objects;
create policy "Admins can update template artwork"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'template-artwork'
    and (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
  )
  with check (
    bucket_id = 'template-artwork'
    and (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
  );

drop policy if exists "Admins can delete template artwork" on storage.objects;
create policy "Admins can delete template artwork"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'template-artwork'
    and (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
  );
