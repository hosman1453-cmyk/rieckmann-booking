# Rieckmann Booking

Custom online appointment booking system for a physiotherapy practice. The project replaces an external booking workflow with a maintainable Next.js and Supabase application for public appointment requests and protected administration.

The application focuses on the core booking process: patients can choose services, therapists, dates, and available time slots, while administrative access and sensitive data remain behind server-side authorization and Supabase Row Level Security.

## Features

- Online appointment booking for physiotherapy services
- Therapist-specific availability and working-hour checks
- 20, 40, and 60 minute appointment durations
- Hausbesuch appointment support
- Admin dashboard for appointment and scheduling management
- Protected prescription file access for authorized admins
- Server-side booking validation
- Atomic booking creation through a PostgreSQL RPC
- Conflict and double-booking protection
- Server-side booking rate limiting
- HMAC-derived client identifiers for rate limiting instead of stored raw IP addresses

## Architecture

```text
Browser
   |
   v
Next.js App Router
   |
   +--> /api/availability
   |       |
   |       +--> minimal availability response
   |       +--> Supabase server-side access
   |
   +--> /api/book
   |       |
   |       +--> rate limiting
   |       +--> server-side validation
   |       +--> atomic Supabase RPC
   |
   +--> /admin
           |
           +--> Supabase Auth
           +--> admin_users authorization
           +--> is_admin() RLS policies
```

Public booking requests go through trusted Next.js route handlers. The browser no longer directly inserts appointments or reads full appointment records for availability checks.

## Security Design

- Public appointment creation is handled by `/api/book`, not by direct browser inserts.
- The Supabase service-role key is used only in server-side code.
- Booking data is validated on the server before database writes.
- Appointment creation uses an atomic PostgreSQL RPC to reduce race-condition risk.
- Supabase RLS blocks anonymous direct access to sensitive booking tables.
- Admin access uses Supabase Auth plus an `admin_users` authorization model.
- RLS policies use `is_admin()` so an authenticated user is not automatically an admin.
- Prescription signed URLs require true admin authorization.
- Public booking attempts are rate limited server-side.
- Raw client IP addresses are not stored for rate limiting; an HMAC-derived identifier is used.
- Secrets are expected to be supplied through environment variables and are not committed.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Supabase
- PostgreSQL
- Vercel
- FullCalendar
- Tailwind CSS

## Environment Variables

Copy `.env.example` to `.env.local` and provide deployment-specific values:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BOOKING_RATE_LIMIT_SECRET=
```

Optional Supabase Edge Function email settings are documented separately in `.env.example`.

## Local Development

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the example environment file:

   ```bash
   cp .env.example .env.local
   ```

4. Configure the Supabase values in `.env.local`.
5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`.

## Database / Migrations

Supabase migrations are stored in:

```text
supabase/migrations/
```

The migrations cover public booking security, the atomic booking RPC, admin authorization, RLS hardening, and booking rate limiting. Apply migrations through the normal Supabase deployment process for the target environment.

## Deployment

The application is designed for deployment on Vercel with Supabase as the backend. Production deployments require the environment variables above, the Supabase migrations, and a seeded admin user in `public.admin_users`.

## Project Motivation

This project explores how a real appointment-booking process in a small physiotherapy practice can be analyzed, simplified, and implemented as a maintainable custom application.

Rather than treating booking as only a frontend problem, the project models the complete process: availability, validation, scheduling conflicts, authorization, sensitive data access, and production safeguards.

The result is a focused alternative to an external booking workflow that gives the practice greater control over its booking logic and technical architecture.

## Repository Evidence

The main implementation claims are linked to their repository evidence below.

| Capability | Repository evidence | Verification limit |
|---|---|---|
| Public booking through a trusted server boundary | [`app/api/book/route.ts`](app/api/book/route.ts) | Implemented in source; no public production claim |
| Minimal availability response without full appointment records | [`app/api/availability/route.ts`](app/api/availability/route.ts) | Implemented in source |
| Service, duration, working-hour, block, and conflict validation | [`lib/booking-rules.ts`](lib/booking-rules.ts) and [`app/api/book/route.ts`](app/api/book/route.ts) | Implemented in source; no automated test suite in this repository |
| Atomic appointment creation and database-level conflict protection | [`20260828124343_public_booking_expand_rpc.sql`](supabase/migrations/20260828124343_public_booking_expand_rpc.sql) | Database migration included; target deployment is not publicly verified |
| Authenticated admin authorization | [`lib/admin-auth.ts`](lib/admin-auth.ts) and [`20260828130000_admin_authorization_expand.sql`](supabase/migrations/20260828130000_admin_authorization_expand.sql) | Authorization model implemented in source |
| Admin-only Row Level Security | [`20260828131000_admin_authorization_contract.sql`](supabase/migrations/20260828131000_admin_authorization_contract.sql) | Migration contract included |
| HMAC-based server-side booking rate limiting | [`lib/booking-rate-limit.ts`](lib/booking-rate-limit.ts) and [`20260829101000_fix_booking_rate_limit_timestamp.sql`](supabase/migrations/20260829101000_fix_booking_rate_limit_timestamp.sql) | Implemented in source; runtime metrics are not published |
| Booking and administration interfaces | [`app/book/page.tsx`](app/book/page.tsx) and [`app/admin/page.tsx`](app/admin/page.tsx) | UI source is included; screenshots and a public demo are not currently included |

Relevant implementation history:

- [`94bc64d`](https://github.com/hosman1453-cmyk/rieckmann-booking/commit/94bc64d): secure public booking flow
- [`2183d12`](https://github.com/hosman1453-cmyk/rieckmann-booking/commit/2183d12): role-aware admin authorization
- [`3b479e0`](https://github.com/hosman1453-cmyk/rieckmann-booking/commit/3b479e0): admin-only RLS policies
- [`e16a1dd`](https://github.com/hosman1453-cmyk/rieckmann-booking/commit/e16a1dd): booking rate limiting
- [`2be5567`](https://github.com/hosman1453-cmyk/rieckmann-booking/commit/2be5567): Next.js security upgrade

## Verification Scope

- The repository documents and implements the core application and security architecture.
- The current repository does not include an automated test suite or CI workflow.
- No public live demo or production deployment claim is made in this README.
- Real patient data, deployment secrets, and production environment files are not part of the repository.

## Status

Core booking, server-side validation, conflict protection, admin authorization, RLS, and rate limiting are implemented in the repository. Email notification automation is not part of the current core release. Production operation is outside the verification scope of this public portfolio repository.
