-- ============================================================
-- BinStashR database schema  (v2 — adds households / sharing)
-- Run this in your Supabase project: SQL Editor > New query > paste > Run.
-- Safe to run again on an existing database; it only adds what's missing.
-- ============================================================

-- ----- Containers -----
create table if not exists public.containers (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  household_id uuid,
  name        text not null default 'Untitled',
  location    text default '',
  category    text default '',
  description text default '',
  expires     date,
  photos      jsonb not null default '[]'::jsonb,
  contents    jsonb not null default '[]'::jsonb,
  history     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.containers add column if not exists expires date;
alter table public.containers add column if not exists history jsonb not null default '[]'::jsonb;
alter table public.containers add column if not exists household_id uuid;

-- ----- Per-user settings -----
create table if not exists public.settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  reseller_mode  boolean not null default false,
  active_household uuid,
  plan           text not null default 'trial',     -- 'trial' | 'active' | 'free'
  trial_ends     timestamptz,                        -- when the free trial expires
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.settings add column if not exists active_household uuid;
alter table public.settings add column if not exists plan text not null default 'trial';
alter table public.settings add column if not exists trial_ends timestamptz;
alter table public.settings add column if not exists created_at timestamptz not null default now();
alter table public.settings add column if not exists default_label_size text;
alter table public.settings add column if not exists terms_version integer default 0;
alter table public.settings add column if not exists terms_agreed_at timestamptz;
-- Per-household reseller mode overrides for this user.
-- JSON object like {"<household-uuid>": true, "<household-uuid>": false}.
-- Personal space (null) still uses the top-level reseller_mode column.
alter table public.settings add column if not exists reseller_by_space jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists onboarded boolean not null default false;

-- ============================================================
-- Feedback / bug reports from users
-- ============================================================
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  kind        text not null default 'feedback',  -- feedback | bug | idea
  message     text not null,
  app_state   jsonb,                              -- e.g. {"items": 12, "households": 1}
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "view own feedback" on public.feedback;
create policy "view own feedback" on public.feedback
  for select using (auth.uid() = user_id);
drop policy if exists "create own feedback" on public.feedback;
create policy "create own feedback" on public.feedback
  for insert with check (auth.uid() = user_id);

-- ----- Households -----
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My household',
  owner_id   uuid not null references auth.users (id) on delete cascade,
  join_code  text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  email        text,
  role         text not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email        text not null,
  invited_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- Helper functions (security definer to avoid RLS recursion)
-- ============================================================
create or replace function public.is_household_member(h uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = h and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(h uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.households hh
    where hh.id = h and hh.owner_id = auth.uid()
  ) or exists (
    select 1 from public.household_members m
    where m.household_id = h and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.join_household_by_code(code text)
returns uuid language plpgsql security definer as $$
declare hid uuid;
begin
  select id into hid from public.households where join_code = upper(code);
  if hid is null then return null; end if;
  insert into public.household_members (household_id, user_id, email, role)
  values (hid, auth.uid(), (select email from auth.users where id = auth.uid()), 'member')
  on conflict (household_id, user_id) do nothing;
  return hid;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists containers_touch on public.containers;
create trigger containers_touch before update on public.containers
  for each row execute function public.touch_updated_at();

create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer as $$
begin
  insert into public.household_members (household_id, user_id, email, role)
  values (new.id, new.owner_id, (select email from auth.users where id = new.owner_id), 'owner')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists households_add_owner on public.households;
create trigger households_add_owner after insert on public.households
  for each row execute function public.add_owner_membership();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.containers          enable row level security;
alter table public.settings            enable row level security;
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.household_invites   enable row level security;

drop policy if exists "own containers" on public.containers;
drop policy if exists "view containers" on public.containers;
create policy "view containers" on public.containers
  for select using (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_member(household_id))
  );

drop policy if exists "insert containers" on public.containers;
create policy "insert containers" on public.containers
  for insert with check (
    auth.uid() = user_id
    and (household_id is null or public.is_household_member(household_id))
  );

drop policy if exists "update containers" on public.containers;
create policy "update containers" on public.containers
  for update using (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_member(household_id))
  );

drop policy if exists "delete containers" on public.containers;
create policy "delete containers" on public.containers
  for delete using (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_owner(household_id))
  );

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "view households" on public.households;
create policy "view households" on public.households
  for select using (public.is_household_member(id) or owner_id = auth.uid());

drop policy if exists "create households" on public.households;
create policy "create households" on public.households
  for insert with check (owner_id = auth.uid());

drop policy if exists "owner update households" on public.households;
create policy "owner update households" on public.households
  for update using (owner_id = auth.uid());

drop policy if exists "owner delete households" on public.households;
create policy "owner delete households" on public.households
  for delete using (owner_id = auth.uid());

drop policy if exists "view members" on public.household_members;
create policy "view members" on public.household_members
  for select using (public.is_household_member(household_id));

drop policy if exists "insert members" on public.household_members;
create policy "insert members" on public.household_members
  for insert with check (user_id = auth.uid() or public.is_household_owner(household_id));

drop policy if exists "delete members" on public.household_members;
create policy "delete members" on public.household_members
  for delete using (user_id = auth.uid() or public.is_household_owner(household_id));

drop policy if exists "update members" on public.household_members;
create policy "update members" on public.household_members
  for update using (public.is_household_owner(household_id));

drop policy if exists "view invites" on public.household_invites;
create policy "view invites" on public.household_invites
  for select using (public.is_household_member(household_id) or email = (select email from auth.users where id = auth.uid()));

drop policy if exists "create invites" on public.household_invites;
create policy "create invites" on public.household_invites
  for insert with check (public.is_household_member(household_id));

drop policy if exists "delete invites" on public.household_invites;
create policy "delete invites" on public.household_invites
  for delete using (public.is_household_owner(household_id));

-- ============================================================
-- Storage bucket for container photos.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "own photo uploads" on storage.objects;
create policy "own photo uploads" on storage.objects
  for insert with check (
    bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own photo deletes" on storage.objects;
create policy "own photo deletes" on storage.objects
  for delete using (
    bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "public photo reads" on storage.objects;
create policy "public photo reads" on storage.objects
  for select using (bucket_id = 'photos');

-- ============================================================
-- GRANTING FREE / COMPLIMENTARY ACCESS TO SPECIFIC USERS
-- ------------------------------------------------------------
-- Plans live in public.settings.plan and can be:
--   'trial'  = free trial, full access until trial_ends
--   'active' = paid (Stripe will set this later)
--   'comp'   = complimentary: full access forever, never billed  ← give to friends/family/yourself
--   'free'   = limited (after trial ends, no payment)
--
-- To give someone complimentary lifetime access, find their user id by email,
-- then set their plan to 'comp'. Run this in the SQL Editor:
--
--   update public.settings s
--   set plan = 'comp', updated_at = now()
--   from auth.users u
--   where u.id = s.user_id and u.email = 'friend@example.com';
--
-- If the person has signed in but has no settings row yet, insert one:
--
--   insert into public.settings (user_id, plan)
--   select id, 'comp' from auth.users where email = 'friend@example.com'
--   on conflict (user_id) do update set plan = 'comp', updated_at = now();
--
-- To revoke and put them back on the normal flow, set plan = 'free' (or 'trial').
-- ============================================================

-- ============================================================
-- Pre-printed label order requests
-- ============================================================
create table if not exists public.label_orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text,
  size        text not null,
  count       integer not null default 0,
  notes       text,
  status      text not null default 'requested',  -- requested | quoted | shipped | cancelled
  created_at  timestamptz not null default now()
);

alter table public.label_orders enable row level security;

drop policy if exists "view own orders" on public.label_orders;
create policy "view own orders" on public.label_orders
  for select using (auth.uid() = user_id);

drop policy if exists "create own orders" on public.label_orders;
create policy "create own orders" on public.label_orders
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- Floor plans / maps with pin-dropped container locations
-- ============================================================
create table if not exists public.maps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  household_id uuid,
  name         text not null default 'Map',
  image_url    text not null,          -- public URL to the map image (svg/png/jpg)
  width        integer,                -- original pixel width (for coordinate math)
  height       integer,                -- original pixel height
  created_at   timestamptz not null default now()
);

alter table public.containers add column if not exists map_id uuid;
alter table public.containers add column if not exists pin_x real;   -- 0.0–1.0 fraction of width
alter table public.containers add column if not exists pin_y real;   -- 0.0–1.0 fraction of height

alter table public.maps enable row level security;

-- Bucket for floor-plan images
insert into storage.buckets (id, name, public)
values ('maps', 'maps', true)
on conflict (id) do nothing;

drop policy if exists "own map uploads" on storage.objects;
create policy "own map uploads" on storage.objects
  for insert with check (
    bucket_id = 'maps' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own map deletes" on storage.objects;
create policy "own map deletes" on storage.objects
  for delete using (
    bucket_id = 'maps' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "public map reads" on storage.objects;
create policy "public map reads" on storage.objects
  for select using (bucket_id = 'maps');

-- Maps are visible if you own them OR they belong to a household you're in.
drop policy if exists "view maps" on public.maps;
create policy "view maps" on public.maps
  for select using (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_member(household_id))
  );

drop policy if exists "insert maps" on public.maps;
create policy "insert maps" on public.maps
  for insert with check (
    auth.uid() = user_id
    and (household_id is null or public.is_household_member(household_id))
  );

drop policy if exists "update maps" on public.maps;
create policy "update maps" on public.maps
  for update using (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_member(household_id))
  );

drop policy if exists "delete maps" on public.maps;
create policy "delete maps" on public.maps
  for delete using (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_owner(household_id))
  );
