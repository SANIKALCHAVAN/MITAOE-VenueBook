# MITAOE Smart Venue Booking System (VenueBook)

A full-stack campus venue booking and management platform with role-based authentication, student PRN verification, teacher email authorization, administrator approvals, concurrency-safe booking conflict prevention, and immutable audit logs.

---

## Confirmed Architecture

- **Frontend**: React + Vite (Fast SPA, responsive design system, dynamic status monitor)
- **Backend**: Node.js + Express (`server/app.js`, `server/index.js`)
- **Authentication**: Supabase Auth (with institutional PRN mapping and server-side token verification via `@supabase/supabase-js`)
- **Database**: Supabase PostgreSQL (primary cloud database with GiST exclusion constraints, RLS policies, and atomic RPC functions)
- **Roles**: Student, Teacher, Admin

---

## Key Features

- **Three Distinct User Roles**:
  - **Student**: Sign in using institutional PRN (Permanent Registration Number) mapped to Supabase Auth.
  - **Teacher**: Sign in using assigned, verified college email address (`@mitaoe.ac.in`).
  - **Admin**: Dedicated administrator control gateway with privilege separation.
- **Concurrency-Safe Conflict Prevention**:
  - PostgreSQL GiST exclusion constraint (`no_overlapping_approved_venue_bookings`) preventing overlapping approved bookings at the database engine level.
  - Concurrency-safe atomic transaction RPCs (`approve_booking_atomic`, `reject_booking_atomic`).
  - Overlap validation on initial submission.
- **Admin Control Center**:
  - Approve pending requests (atomically revalidates slot availability with row locks).
  - Reject pending requests with mandatory recorded reason.
  - Campus Venue Management (create, edit, update capacity, activate/deactivate).
  - User Directory & Provisioning (register student PRNs and teacher emails directly into Supabase Auth & PostgreSQL).
  - Security & Decision Audit Logs.
- **Resilient Fallback Engine**:
  - When Supabase credentials or network connectivity are active, all authentication and data operations run directly against Supabase Auth and Supabase PostgreSQL.
  - If a live Supabase project is not yet provisioned, the backend seamlessly routes to verified local SQLite storage (`data/venuebook.db`), preventing downtime during development and evaluation.

---

## Supabase PostgreSQL & Auth Setup

### Step 1: Execute Database Schema

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to the **SQL Editor**.
3. Paste the contents of `supabase/schema.sql` and click **Run**.
   - This sets up `btree_gist`, enum `user_role`, `profiles`, `venues`, `bookings`, `audit_logs`, `notifications`, the `no_overlapping_approved_venue_bookings` exclusion constraint, auth trigger `handle_new_auth_user`, Row-Level Security policies, and atomic RPCs (`approve_booking_atomic`, `reject_booking_atomic`, `cancel_booking_user`).

### Step 2: Configure Environment Variables

Create or update `.env` in the root folder (based on `.env.example`):

```env
# Backend Server Configuration
PORT=5173
NODE_ENV=development

# Supabase Server-side (Used by Express Backend)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Supabase Client-side (Exposed to Vite Frontend - Public Anon Key Only)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

> **Security Note:** Never expose `SUPABASE_SERVICE_ROLE_KEY` to frontend code or commit live keys to public repositories.

### Step 3: Seed Institutional Users in Supabase Auth

Run the provisioning script to create the initial Student, Teacher, and Admin accounts in Supabase Auth & PostgreSQL:

```bash
node supabase/seed-users.js
```

### Step 4: Migrate Existing SQLite Data to Supabase

Run the migration script to copy existing venues, bookings, and user profiles from `data/venuebook.db` to Supabase PostgreSQL:

```bash
node supabase/migrate-from-sqlite.js
```

> The SQLite database file (`data/venuebook.db`) is safely preserved.

---

## Development & Testing

### Run Development Server (Frontend + Express API)

```bash
npm run dev
```

Opens `http://localhost:5173` with Vite HMR and the embedded Express backend middleware.

### Run Production Server (Built Bundle + Express API)

```bash
npm run build
npm run start
```

### Run Automated Test Suite

```bash
npm test
```

Runs 23 automated tests verifying:
- Authentication, Supabase token decoding, & PRN validation
- Role authorization boundaries (Student vs. Teacher vs. Admin)
- Private booking data isolation
- Venue capacity enforcement
- Inactive venue booking restrictions
- Concurrency-safe atomic approval & overlap conflict prevention
- Rejection with mandatory recorded reason
- Requester cancellation permissions

---

## Standard Demo Accounts

The initial accounts provisioned in Supabase Auth and local storage:

| Role | Login Identifier | Password | Description |
| :--- | :--- | :--- | :--- |
| **Student** | `PRN2024001` | `Student@MITAOE2026` | Aarav Patil (Computer Engineering) |
| **Student** | `PRN2024002` | `Student@MITAOE2026` | Meera Joshi (Information Technology) |
| **Student** | `PRN2024003` | `Student@MITAOE2026` | Rohan Umbarepatil (Mechanical Engineering) |
| **Teacher** | `prof.sharma@mitaoe.ac.in` | `Teacher@MITAOE2026` | Prof. Rajesh Sharma (Computer Engineering) |
| **Teacher** | `prof.patil@mitaoe.ac.in` | `Teacher@MITAOE2026` | Dr. Sunita Patil (Electronics Engineering) |
| **Admin** | `admin@mitaoe.ac.in` | `Admin@MITAOE2026` | MITAOE Campus Administrator |

---

## REST API Specification

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/system/status` | Public | Real-time connectivity & database provider health |
| `POST` | `/api/auth/student-login` | Public | PRN-based student login (mapped to Supabase Auth) |
| `POST` | `/api/auth/teacher-login` | Public | Institutional email login for teachers |
| `POST` | `/api/auth/admin-login` | Public | Administrator login |
| `GET` | `/api/auth/me` | Authenticated | Current user profile, verified role & provider |
| `POST` | `/api/auth/recover-password` | Public | Password recovery flow |
| `GET` | `/api/venues` | Public | Venue catalog (`?includeInactive=true` for admin) |
| `POST` | `/api/venues` | Admin Only | Create campus venue |
| `PUT` | `/api/venues/:id` | Admin Only | Update venue details or toggle active status |
| `GET` | `/api/bookings` | Authenticated | Bookings list (filtered by user role) |
| `POST` | `/api/bookings` | Authenticated | Create booking request (starts as `pending`) |
| `PUT` | `/api/bookings/:id/status` | Admin Only | Approve (with atomic lock) or Reject (with reason) |
| `PUT` | `/api/bookings/:id/cancel` | Requester | Cancel own booking |
| `GET` | `/api/admin/stats` | Admin Only | Overview metrics & booking statistics |
| `GET` | `/api/admin/users` | Admin Only | User directory |
| `POST` | `/api/admin/users` | Admin Only | Provision new student/teacher/admin |
| `GET` | `/api/admin/audit-logs` | Admin Only | Immutable security & decision logs |
| `GET` | `/api/notifications` | Authenticated | User notification feed |
| `POST` | `/api/notifications/mark-read` | Authenticated | Acknowledge notifications |

---

## Project Structure

```
├── data/
│   └── venuebook.db               # Preserved SQLite database
├── server/
│   ├── app.js                     # Express application & REST API routes
│   ├── auth.js                    # Local password verification & token utilities
│   ├── db.js                      # Local SQLite data access queries
│   ├── index.js                   # Node.js + Express production entry point
│   └── supabase.js                # Supabase Auth & PostgreSQL data access layer
├── src/
│   ├── api.js                     # Unified frontend API client
│   ├── App.jsx                    # React UI with connection status & role views
│   ├── main.jsx                   # React entry point
│   └── styles.css                 # MITAOE VenueBook design system & styles
├── supabase/
│   ├── migrate-from-sqlite.js     # Data migration script (SQLite -> Supabase)
│   ├── schema.sql                 # Production PostgreSQL schema, RLS & RPCs
│   └── seed-users.js              # Supabase Auth user seeding script
├── test/
│   ├── api_endpoints.test.js      # Express API integration tests
│   ├── auth_and_roles.test.js     # Role security & PRN login tests
│   └── booking_workflow.test.js   # Booking workflow & conflict tests
├── .env.example                   # Environment variable template
├── package.json                   # Project scripts and dependencies
└── vite.config.js                 # Vite configuration with Express middleware
```

# MITAOE-VenueBook
