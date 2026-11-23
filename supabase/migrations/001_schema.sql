-- 001: tabelle, regole di accesso (RLS) e funzioni di prenotazione.
create extension if not exists btree_gist;

-- ===== Tabelle =====
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  address text,
  phone text,
  timezone text not null default 'Europe/Rome'
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'client' check (role in ('superadmin','owner','barber','client')),
  org_id uuid references organizations on delete set null, -- titolare e barbieri
  full_name text,
  phone text
);

create table barbers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references profiles on delete set null,
  shop_id uuid not null references shops on delete cascade,
  display_name text not null,
  cancel_limit_hours int not null default 2 check (cancel_limit_hours >= 0),
  active boolean not null default true
);

create table services (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers on delete cascade,
  name text not null,
  duration_min int not null check (duration_min between 5 and 480),
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true
);

create table working_hours (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = lunedì
  start_time time not null,
  end_time time not null check (end_time > start_time)
);

create table time_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  profile_id uuid references profiles on delete set null, -- null = cliente inserito a mano
  full_name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, profile_id)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops on delete cascade,
  barber_id uuid not null references barbers on delete cascade,
  customer_id uuid not null references customers on delete cascade,
  service_id uuid references services on delete set null,
  service_name text not null,   -- copia: lo storico resta anche se il servizio cambia
  price_cents int not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'booked' check (status in ('booked','cancelled','done','no_show')),
  source text not null default 'app' check (source in ('app','manual')),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- lo stesso barbiere non può avere due appuntamenti sovrapposti
  constraint no_overlap exclude using gist (barber_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('booked','done'))
);

create index on appointments (barber_id, starts_at);
create index on appointments (customer_id, starts_at);
create index on services (barber_id);
create index on working_hours (barber_id, weekday);
create index on time_off (barber_id, starts_at);

-- ===== Chi sono io =====
create function my_role() returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() $$;

create function my_org() returns uuid language sql stable security definer set search_path = public
as $$ select org_id from profiles where id = auth.uid() $$;

create function is_superadmin() returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(my_role() = 'superadmin', false) $$;

create function is_org_owner(p_org uuid) returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(my_role() = 'owner' and my_org() = p_org, false) $$;

create function barber_org(p_barber uuid) returns uuid language sql stable security definer set search_path = public
as $$ select s.org_id from barbers b join shops s on s.id = b.shop_id where b.id = p_barber $$;

-- superadmin, titolare dell'organizzazione o il barbiere stesso
create function can_manage_barber(p_barber uuid) returns boolean language sql stable security definer set search_path = public
as $$
  select is_superadmin()
      or is_org_owner(barber_org(p_barber))
      or exists (select 1 from barbers where id = p_barber and profile_id = auth.uid())
$$;

-- queste due evitano che le regole di customers e appointments si richiamino a vicenda all'infinito
create function is_my_customer(p_customer uuid) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from customers where id = p_customer and profile_id = auth.uid()) $$;

create function served_by_me(p_customer uuid) returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from appointments a join barbers b on b.id = a.barber_id
                 where a.customer_id = p_customer and b.profile_id = auth.uid())
$$;

-- nuovo utente registrato = cliente
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
          nullif(trim(new.raw_user_meta_data->>'phone'), ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ===== Regole di accesso =====
alter table organizations enable row level security;
alter table shops enable row level security;
alter table profiles enable row level security;
alter table barbers enable row level security;
alter table services enable row level security;
alter table working_hours enable row level security;
alter table time_off enable row level security;
alter table customers enable row level security;
alter table appointments enable row level security;

create policy org_read on organizations for select using (is_superadmin() or id = my_org());
create policy org_admin on organizations for all using (is_superadmin()) with check (is_superadmin());
create policy org_owner_update on organizations for update using (is_org_owner(id)) with check (is_org_owner(id));

-- sedi, barbieri, servizi e orari sono pubblici: servono a chi prenota
create policy shops_read on shops for select using (true);
create policy shops_write on shops for all
  using (is_superadmin() or is_org_owner(org_id)) with check (is_superadmin() or is_org_owner(org_id));

create policy profiles_read on profiles for select
  using (id = auth.uid() or is_superadmin() or (org_id is not null and is_org_owner(org_id)));
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_superadmin()) with check (id = auth.uid() or is_superadmin());
-- da soli si cambiano solo nome e telefono, mai ruolo o organizzazione
revoke update on profiles from anon, authenticated;
grant update (full_name, phone) on profiles to authenticated;

create policy barbers_read on barbers for select using (true);
create policy barbers_insert on barbers for insert
  with check (is_superadmin() or is_org_owner((select org_id from shops where id = shop_id)));
create policy barbers_update on barbers for update using (can_manage_barber(id))
  with check (is_superadmin() or is_org_owner((select org_id from shops where id = shop_id))
              or (profile_id = auth.uid() and (select org_id from shops where id = shop_id) = my_org()));
create policy barbers_delete on barbers for delete using (is_superadmin() or is_org_owner(barber_org(id)));

create policy services_read on services for select using (true);
create policy services_write on services for all using (can_manage_barber(barber_id)) with check (can_manage_barber(barber_id));

create policy hours_read on working_hours for select using (true);
create policy hours_write on working_hours for all using (can_manage_barber(barber_id)) with check (can_manage_barber(barber_id));

-- le ferie le vede solo chi gestisce il barbiere (gli orari liberi li calcola available_slots)
create policy timeoff_all on time_off for all using (can_manage_barber(barber_id)) with check (can_manage_barber(barber_id));

-- i clienti si creano solo con le funzioni book / staff_book
create policy customers_read on customers for select using (
  profile_id = auth.uid() or is_superadmin() or is_org_owner(org_id) or served_by_me(id));
create policy customers_update on customers for update using (
  is_superadmin() or is_org_owner(org_id) or served_by_me(id))
  with check (is_superadmin() or is_org_owner(org_id) or org_id = my_org());

-- appuntamenti: si creano e si annullano solo con le funzioni; lo staff può modificarli
create policy appts_read on appointments for select using (
  can_manage_barber(barber_id) or is_my_customer(customer_id));
create policy appts_staff_update on appointments for update
  using (can_manage_barber(barber_id)) with check (can_manage_barber(barber_id));
create policy appts_staff_delete on appointments for delete using (can_manage_barber(barber_id));

-- ===== Storico clienti =====
-- security_invoker: ognuno vede solo i numeri degli appuntamenti che può vedere
-- (il barbiere vede le sue visite, il titolare tutte quelle dell'organizzazione)
create view customer_stats with (security_invoker = true) as
select c.id, c.org_id, c.full_name, c.phone, c.email, c.notes, c.profile_id,
  max(a.starts_at) filter (where a.status = 'done') as last_visit,
  (current_date - (max(a.starts_at) filter (where a.status = 'done'))::date) as days_since,
  (array_agg(a.service_name order by a.starts_at desc) filter (where a.status = 'done'))[1] as last_service,
  count(a.id) filter (where a.status = 'done') as visits,
  min(a.starts_at) filter (where a.status = 'booked' and a.starts_at > now()) as next_appointment
from customers c
join appointments a on a.customer_id = c.id
group by c.id;

-- ===== Prenotazioni =====
-- l'orario è dentro l'orario di lavoro, fuori dalle ferie e nel futuro?
create function slot_ok(p_barber uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = public
as $$
  select p_start > now()
    and exists (
      select 1 from working_hours w
      join barbers b on b.id = w.barber_id
      join shops s on s.id = b.shop_id
      where w.barber_id = p_barber and b.active
        and (p_start at time zone s.timezone)::date = (p_end at time zone s.timezone)::date
        and w.weekday = extract(isodow from p_start at time zone s.timezone)
        and (p_start at time zone s.timezone)::time >= w.start_time
        and (p_end at time zone s.timezone)::time <= w.end_time)
    and not exists (
      select 1 from time_off t where t.barber_id = p_barber
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start, p_end))
$$;

-- orari liberi di un giorno. p_barber null = "chiunque": una riga per ogni barbiere libero
create function available_slots(p_shop uuid, p_day date, p_service_name text, p_barber uuid default null)
returns table (barber_id uuid, barber_name text, service_id uuid, starts_at timestamptz, price_cents int)
language sql stable security definer set search_path = public
as $$
  select b.id, b.display_name, sv.id, g.t, sv.price_cents
  from barbers b
  join shops s on s.id = b.shop_id
  join services sv on sv.barber_id = b.id and sv.active and lower(sv.name) = lower(p_service_name)
  join working_hours w on w.barber_id = b.id and w.weekday = extract(isodow from p_day)
  cross join lateral generate_series(
      (p_day + w.start_time) at time zone s.timezone,
      (p_day + w.end_time) at time zone s.timezone - make_interval(mins => sv.duration_min),
      interval '15 minutes') as g(t)
  where b.shop_id = p_shop and b.active and (p_barber is null or b.id = p_barber)
    and g.t > now()
    and not exists (select 1 from appointments a where a.barber_id = b.id and a.status in ('booked','done')
                    and tstzrange(a.starts_at, a.ends_at) && tstzrange(g.t, g.t + make_interval(mins => sv.duration_min)))
    and not exists (select 1 from time_off t where t.barber_id = b.id
                    and tstzrange(t.starts_at, t.ends_at) && tstzrange(g.t, g.t + make_interval(mins => sv.duration_min)))
  order by g.t, b.display_name
$$;

-- inserimento con messaggio chiaro se l'orario è stato appena preso
create function insert_appointment(p_sv services, p_customer uuid, p_start timestamptz, p_source text)
returns appointments language plpgsql security definer set search_path = public
as $$
declare r appointments;
begin
  insert into appointments (shop_id, barber_id, customer_id, service_id, service_name, price_cents, starts_at, ends_at, source)
  select b.shop_id, b.id, p_customer, p_sv.id, p_sv.name, p_sv.price_cents, p_start,
         p_start + make_interval(mins => p_sv.duration_min), p_source
  from barbers b where b.id = p_sv.barber_id
  returning * into r;
  return r;
exception when exclusion_violation then
  raise exception 'Orario non più disponibile' using errcode = 'P0001';
end $$;

-- il cliente prenota
create function book(p_service uuid, p_start timestamptz)
returns appointments language plpgsql security definer set search_path = public
as $$
declare sv services; v_org uuid; v_cust uuid; p profiles;
begin
  if auth.uid() is null then raise exception 'Devi accedere per prenotare'; end if;
  select * into sv from services where id = p_service and active;
  if not found then raise exception 'Servizio non disponibile'; end if;
  if not slot_ok(sv.barber_id, p_start, p_start + make_interval(mins => sv.duration_min)) then
    raise exception 'Orario non disponibile';
  end if;
  v_org := barber_org(sv.barber_id);
  select * into p from profiles where id = auth.uid();
  insert into customers (org_id, profile_id, full_name, phone, email)
  values (v_org, auth.uid(), coalesce(p.full_name, 'Cliente'), p.phone, (select email from auth.users where id = auth.uid()))
  on conflict (org_id, profile_id) do update set phone = coalesce(excluded.phone, customers.phone)
  returning id into v_cust;
  return insert_appointment(sv, v_cust, p_start, 'app');
end $$;

-- il barbiere (o il titolare) inserisce un appuntamento a mano, anche fuori orario
create function staff_book(p_service uuid, p_start timestamptz, p_customer uuid default null,
                           p_name text default null, p_phone text default null)
returns appointments language plpgsql security definer set search_path = public
as $$
declare sv services; v_org uuid; v_cust uuid := p_customer;
begin
  select * into sv from services where id = p_service;
  if not found or not can_manage_barber(sv.barber_id) then raise exception 'Non permesso'; end if;
  v_org := barber_org(sv.barber_id);
  if v_cust is null then
    if coalesce(trim(p_name), '') = '' then raise exception 'Serve il nome del cliente'; end if;
    insert into customers (org_id, full_name, phone) values (v_org, trim(p_name), nullif(trim(p_phone), ''))
    returning id into v_cust;
  elsif not exists (select 1 from customers where id = v_cust and org_id = v_org) then
    raise exception 'Cliente non trovato';
  end if;
  return insert_appointment(sv, v_cust, p_start, 'manual');
end $$;

-- controlla chi può annullare o spostare: lo staff sempre, il cliente fino al limite del barbiere
create function check_client_change(a appointments) returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if a.status <> 'booked' then raise exception 'Appuntamento non modificabile'; end if;
  if can_manage_barber(a.barber_id) then return; end if;
  if not exists (select 1 from customers c where c.id = a.customer_id and c.profile_id = auth.uid()) then
    raise exception 'Non permesso';
  end if;
  if a.starts_at - now() < make_interval(hours => (select cancel_limit_hours from barbers where id = a.barber_id)) then
    raise exception 'Troppo tardi: chiama il negozio';
  end if;
end $$;

create function cancel_appointment(p_id uuid) returns appointments
language plpgsql security definer set search_path = public
as $$
declare a appointments;
begin
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'Appuntamento non trovato'; end if;
  perform check_client_change(a);
  update appointments set status = 'cancelled' where id = p_id returning * into a;
  return a;
end $$;

create function reschedule_appointment(p_id uuid, p_start timestamptz) returns appointments
language plpgsql security definer set search_path = public
as $$
declare a appointments; v_end timestamptz;
begin
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'Appuntamento non trovato'; end if;
  perform check_client_change(a);
  v_end := p_start + (a.ends_at - a.starts_at);
  if not can_manage_barber(a.barber_id) and not slot_ok(a.barber_id, p_start, v_end) then
    raise exception 'Orario non disponibile';
  end if;
  update appointments set starts_at = p_start, ends_at = v_end, reminder_sent_at = null
    where id = p_id returning * into a;
  return a;
exception when exclusion_violation then
  raise exception 'Orario non più disponibile' using errcode = 'P0001';
end $$;

-- le funzioni interne non si chiamano dall'app
revoke execute on function insert_appointment(services, uuid, timestamptz, text) from public, anon, authenticated;
revoke execute on function check_client_change(appointments) from public, anon, authenticated;
revoke execute on function book(uuid, timestamptz) from anon;
revoke execute on function staff_book(uuid, timestamptz, uuid, text, text) from anon;
revoke execute on function cancel_appointment(uuid) from anon;
revoke execute on function reschedule_appointment(uuid, timestamptz) from anon;
