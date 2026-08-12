create table public.wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  place_id text not null,
  place_name text not null,
  place_address text not null,
  google_maps_url text not null default '',
  lat double precision not null default 0,
  lng double precision not null default 0,
  notes text,
  created_at timestamptz default now()
);

alter table public.wishlist enable row level security;

create policy "Users manage own wishlist" on public.wishlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
