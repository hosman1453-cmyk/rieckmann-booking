-- FIX 2F contract: remove legacy anonymous direct access to booking/PII tables.
-- Apply only after the FIX 2 application code is deployed and confirmed to book
-- through /api/book. Authenticated broad access is intentionally preserved
-- temporarily for FIX 3 because the current admin UI depends on it.

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('appointments', 'appointment_details', 'patients')
      and (roles && array['anon', 'public']::name[])
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;
