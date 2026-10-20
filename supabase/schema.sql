-- =========================================================
-- MITAOE Smart Venue Booking System (VenueBook)
-- Production Supabase PostgreSQL Schema, RLS & Atomic RPCs
-- =========================================================

-- Enable required PostgreSQL extensions
create extension if not exists btree_gist;
create extension if not exists "uuid-ossp";

-- 1. ENUMS
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('student', 'teacher', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'booking_status') then
    create type public.booking_status as enum ('pending', 'approved', 'rejected', 'cancelled');
  end if;
end $$;

-- 2. PROFILES (Institutional Users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  prn text unique, -- Permanent Registration Number (mandatory for students)
  email text unique not null,
  full_name text not null default '',
  role public.user_role not null default 'student',
  department text,
  account_status text not null default 'active' check (account_status in ('active', 'disabled', 'pending_verification')),
  email_verified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. VENUES
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  venue_type text not null,
  capacity integer not null check (capacity > 0),
  location text not null default 'Campus',
  facilities text[] not null default '{}',
  description text default '',
  color text not null default 'lavender',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. BOOKINGS
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  event_title text not null check (char_length(event_title) between 2 and 100),
  event_type text not null,
  event_date date not null,
  end_date date default null,
  start_time time not null,
  end_time time not null,
  expected_attendees integer not null check (expected_attendees > 0),
  purpose text not null check (char_length(purpose) between 2 and 1000),
  status public.booking_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

-- 5. AUDIT LOGS
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

-- 6. NOTIFICATIONS
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists bookings_venue_date_idx on public.bookings(venue_id, event_date);
create index if not exists bookings_requester_idx on public.bookings(requester_id);
create index if not exists bookings_status_idx on public.bookings(status);
create index if not exists profiles_prn_idx on public.profiles(prn);
create index if not exists profiles_email_idx on public.profiles(email);

-- Exclusion constraint to prevent overlapping approved bookings at the database level
alter table public.bookings
  drop constraint if exists no_overlapping_approved_venue_bookings;

alter table public.bookings
  add constraint no_overlapping_approved_venue_bookings
  exclude using gist (
    venue_id with =,
    event_date with =,
    (tsrange(event_date + start_time, event_date + end_time, '[)')) with &&
  )
  where (status = 'approved');

-- Helper function to check role safely
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Trigger to sync newly registered Supabase Auth users to public.profiles
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, prn, department)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'student'::public.user_role),
    new.raw_user_meta_data ->> 'prn',
    new.raw_user_meta_data ->> 'department'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = coalesce(excluded.role, public.profiles.role);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- ATOMIC BOOKING APPROVAL RPC (Server-side Row Locking & Conflict Prevention)
create or replace function public.approve_booking_atomic(
  p_booking_id uuid,
  p_admin_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_booking record;
  v_venue record;
  v_effective_admin_id uuid := coalesce(p_admin_id, auth.uid());
  v_admin_role public.user_role;
  v_conflict_count integer;
  v_now timestamptz := now();
begin
  -- 1. Verify admin privileges
  if v_effective_admin_id is null then
    raise exception 'Unauthorized: Administrator authentication required';
  end if;

  select role into v_admin_role from public.profiles where id = v_effective_admin_id;
  if v_admin_role != 'admin' then
    raise exception 'Unauthorized: Only campus administrators can approve requests';
  end if;

  -- 2. Lock target booking row
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.status != 'pending' then
    raise exception 'Cannot approve booking: current status is %', v_booking.status;
  end if;

  -- 3. Verify venue is active
  select * into v_venue from public.venues where id = v_booking.venue_id;
  if not found or not v_venue.is_active then
    raise exception 'Cannot approve booking: venue is inactive or unlisted';
  end if;

  -- 4. Check for overlapping approved bookings
  select count(*) into v_conflict_count
  from public.bookings
  where venue_id = v_booking.venue_id
    and event_date = v_booking.event_date
    and status = 'approved'
    and id != v_booking.id
    and start_time < v_booking.end_time
    and end_time > v_booking.start_time;

  if v_conflict_count > 0 then
    raise exception 'Time conflict: Venue is already confirmed for an overlapping event';
  end if;

  -- 5. Atomically update status
  update public.bookings
  set status = 'approved',
      reviewed_by = v_effective_admin_id,
      reviewed_at = v_now,
      updated_at = v_now
  where id = p_booking_id;

  -- 6. Insert audit log
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (
    v_effective_admin_id,
    'APPROVE_BOOKING',
    'booking',
    p_booking_id::text,
    jsonb_build_object(
      'venue_id', v_booking.venue_id,
      'venue_name', v_venue.name,
      'event_title', v_booking.event_title,
      'date', v_booking.event_date,
      'start_time', v_booking.start_time,
      'end_time', v_booking.end_time
    )
  );

  -- 7. Insert requester notification
  insert into public.notifications (user_id, booking_id, title, message)
  values (
    v_booking.requester_id,
    p_booking_id,
    'Booking Request Approved',
    format('Your request for "%s" at %s on %s has been APPROVED by the campus administrator.',
           v_booking.event_title, v_venue.name, v_booking.event_date)
  );

  return jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'approved');
end;
$$;

-- ATOMIC BOOKING REJECTION RPC (Enforces Mandatory Reason)
create or replace function public.reject_booking_atomic(
  p_booking_id uuid,
  p_reason text,
  p_admin_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_booking record;
  v_venue record;
  v_effective_admin_id uuid := coalesce(p_admin_id, auth.uid());
  v_admin_role public.user_role;
  v_now timestamptz := now();
begin
  if v_effective_admin_id is null then
    raise exception 'Unauthorized: Administrator authentication required';
  end if;

  select role into v_admin_role from public.profiles where id = v_effective_admin_id;
  if v_admin_role != 'admin' then
    raise exception 'Unauthorized: Only campus administrators can reject requests';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A rejection reason is mandatory when declining a booking request';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.status != 'pending' then
    raise exception 'Cannot reject booking: current status is %', v_booking.status;
  end if;

  select * into v_venue from public.venues where id = v_booking.venue_id;

  update public.bookings
  set status = 'rejected',
      rejection_reason = trim(p_reason),
      reviewed_by = v_effective_admin_id,
      reviewed_at = v_now,
      updated_at = v_now
  where id = p_booking_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (
    v_effective_admin_id,
    'REJECT_BOOKING',
    'booking',
    p_booking_id::text,
    jsonb_build_object(
      'venue_id', v_booking.venue_id,
      'event_title', v_booking.event_title,
      'reason', trim(p_reason)
    )
  );

  insert into public.notifications (user_id, booking_id, title, message)
  values (
    v_booking.requester_id,
    p_booking_id,
    'Booking Request Declined',
    format('Your request for "%s" was not approved. Reason: %s',
           v_booking.event_title, trim(p_reason))
  );

  return jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'rejected');
end;
$$;

-- ATOMIC BOOKING CANCELLATION RPC (Requester only)
create or replace function public.cancel_booking_user(
  p_booking_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_booking record;
  v_effective_user_id uuid := coalesce(p_user_id, auth.uid());
  v_now timestamptz := now();
begin
  if v_effective_user_id is null then
    raise exception 'Unauthorized: User authentication required';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.requester_id != v_effective_user_id then
    raise exception 'Unauthorized: You can only cancel your own bookings';
  end if;

  if v_booking.status != 'pending' then
    raise exception 'Only pending requests can be cancelled';
  end if;

  update public.bookings
  set status = 'cancelled',
      updated_at = v_now
  where id = p_booking_id;

  return jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'cancelled');
end;
$$;

-- ROW LEVEL SECURITY (RLS) POLICIES
alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.bookings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

-- Profiles: Users see own profile; Admins see all
drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "profiles_update_policy" on public.profiles;
create policy "profiles_update_policy" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_user_role());

-- Venues: Active venues are public/authenticated; Admins manage all
drop policy if exists "venues_select_policy" on public.venues;
create policy "venues_select_policy" on public.venues
  for select
  using (is_active or public.current_user_role() = 'admin');

drop policy if exists "venues_admin_all_policy" on public.venues;
create policy "venues_admin_all_policy" on public.venues
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Bookings: Requesters see own; Admins see all
drop policy if exists "bookings_select_policy" on public.bookings;
create policy "bookings_select_policy" on public.bookings
  for select to authenticated
  using (requester_id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "bookings_insert_policy" on public.bookings;
create policy "bookings_insert_policy" on public.bookings
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and public.current_user_role() in ('student', 'teacher', 'admin')
  );

drop policy if exists "bookings_update_policy" on public.bookings;
create policy "bookings_update_policy" on public.bookings
  for update to authenticated
  using (
    (requester_id = auth.uid() and status = 'pending')
    or public.current_user_role() = 'admin'
  )
  with check (
    (requester_id = auth.uid() and status = 'cancelled')
    or public.current_user_role() = 'admin'
  );

-- Audit logs: Admins can view
drop policy if exists "audit_logs_select_policy" on public.audit_logs;
create policy "audit_logs_select_policy" on public.audit_logs
  for select to authenticated
  using (public.current_user_role() = 'admin');

-- Notifications: Users see own notifications
drop policy if exists "notifications_select_policy" on public.notifications;
create policy "notifications_select_policy" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_policy" on public.notifications;
create policy "notifications_update_policy" on public.notifications
  for update to authenticated
  using (user_id = auth.uid());

-- SEED CAMPUS VENUES
insert into public.venues (name, venue_type, capacity, location, facilities, description, color)
values
  ('Main Auditorium', 'Auditorium', 500, 'Main Building', array['Projector', 'Sound system', 'Stage', 'AC'], 'Central auditorium equipped for major symposiums, annual festivals, and convocations.', 'lavender'),
  ('Seminar Hall A', 'Seminar Hall', 120, 'Academic Block', array['Projector', 'Wi-Fi', 'Microphone', 'Podium'], 'Tiered seating hall ideal for departmental lectures, guest seminars, and workshops.', 'blue'),
  ('Seminar Hall B', 'Seminar Hall', 80, 'Academic Block', array['Projector', 'Wi-Fi', 'Audio'], 'Compact seminar space for student paper presentations and interactive seminars.', 'mint'),
  ('Conference Room', 'Meeting Room', 24, 'Administration Block', array['Display Screen', 'Wi-Fi', 'Video Conferencing'], 'Executive conference suite with hybrid video conferencing and presentation display.', 'peach'),
  ('Innovation Room', 'Event Room', 60, 'Innovation Centre', array['Interactive Display', 'Whiteboard', 'Wi-Fi'], 'Creative workspace designed for design thinking, hackathons, and ideation sessions.', 'pink'),
  ('Open Activity Space', 'Common Space', 100, 'Student Activity Area', array['Flexible seating', 'Power outlets', 'Acoustics'], 'Vibrant indoor commons for cultural rehearsals, club exhibits, and collaborative activities.', 'yellow')
on conflict (name) do update set
  capacity = excluded.capacity,
  facilities = excluded.facilities,
  location = excluded.location,
  description = excluded.description;

-- 7. BOOKING APPROVAL SUMMARY DOCUMENTS
create table if not exists public.booking_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  document_reference text not null unique,
  approval_reference text not null,
  document_type text not null default 'approval_summary',
  file_path text not null default '',
  file_name text not null default '',
  file_size integer default 0,
  mime_type text not null default 'application/pdf',
  generation_status text not null default 'pending' check (generation_status in ('pending', 'generating', 'ready', 'failed')),
  generated_at timestamptz,
  generated_by uuid references public.profiles(id),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_booking_document_type unique (booking_id, document_type)
);

create index if not exists booking_documents_booking_idx on public.booking_documents(booking_id);
create index if not exists booking_documents_ref_idx on public.booking_documents(document_reference);
create index if not exists booking_documents_status_idx on public.booking_documents(generation_status);

alter table public.booking_documents enable row level security;

drop policy if exists "booking_documents_select_policy" on public.booking_documents;
create policy "booking_documents_select_policy" on public.booking_documents
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or exists (
      select 1 from public.bookings b
      where b.id = booking_documents.booking_id
        and b.requester_id = auth.uid()
    )
  );

drop policy if exists "booking_documents_admin_policy" on public.booking_documents;
create policy "booking_documents_admin_policy" on public.booking_documents
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

