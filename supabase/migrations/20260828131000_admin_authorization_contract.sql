-- FIX 3F contract: remove obsolete broad authenticated policies after the
-- admin_users/is_admin expand phase has been deployed and verified.
--
-- Keep:
-- - *_admin_all_expand policies that require public.is_admin()
-- - intentional public read policies used by booking
-- - admin_users policies
-- - public booking RPC privileges

drop policy if exists "authenticated full access" on public.appointments;
drop policy if exists appointments_authenticated_all_temporary on public.appointments;
drop policy if exists appointments_authenticated_all on public.appointments;

drop policy if exists "authenticated full access" on public.appointment_details;
drop policy if exists appointment_details_authenticated_all_temporary on public.appointment_details;
drop policy if exists appointment_details_authenticated_all on public.appointment_details;

drop policy if exists "authenticated full access" on public.patients;
drop policy if exists patients_authenticated_all_temporary on public.patients;
drop policy if exists patients_authenticated_all on public.patients;

drop policy if exists "authenticated full access" on public.therapists;
drop policy if exists therapists_authenticated_all on public.therapists;

drop policy if exists "authenticated full access" on public.therapist_hours;
drop policy if exists therapist_hours_authenticated_all on public.therapist_hours;

drop policy if exists "authenticated full access" on public.blocks;
drop policy if exists blocks_authenticated_all on public.blocks;

drop policy if exists "authenticated full access" on public.verfuegbarzeiten;
drop policy if exists verfuegbarzeiten_authenticated_all on public.verfuegbarzeiten;

drop policy if exists "authenticated full access" on public.hausbesuch_settings;
drop policy if exists hausbesuch_settings_authenticated_all on public.hausbesuch_settings;
