create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text,
  city text,
  plan text,
  contact_time text,
  masked_reference text,
  consent boolean not null default false,
  source_origin text,
  user_agent text
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

alter table public.leads enable row level security;

drop policy if exists "service_role_can_manage_leads" on public.leads;
create policy "service_role_can_manage_leads"
on public.leads
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
