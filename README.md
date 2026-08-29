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

## Status

Core booking, server-side validation, conflict protection, admin authorization, RLS, and rate limiting are implemented. Email notification automation is not part of the current core release.
