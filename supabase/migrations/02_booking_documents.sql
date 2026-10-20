-- =========================================================
-- MITAOE Smart Venue Booking System (VenueBook)
-- Migration 02: Booking Approval Documents Table & Security
-- =========================================================

-- 1. Create booking_documents table
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

-- 2. Indexes for fast lookup
create index if not exists booking_documents_booking_idx on public.booking_documents(booking_id);
create index if not exists booking_documents_ref_idx on public.booking_documents(document_reference);
create index if not exists booking_documents_status_idx on public.booking_documents(generation_status);

-- 3. Row Level Security (RLS)
alter table public.booking_documents enable row level security;

-- Policy: Select - Authorized booking owners (student/teacher) can view their own, Admins can view all
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

-- Policy: Admin can insert/update document records
drop policy if exists "booking_documents_admin_policy" on public.booking_documents;
create policy "booking_documents_admin_policy" on public.booking_documents
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
