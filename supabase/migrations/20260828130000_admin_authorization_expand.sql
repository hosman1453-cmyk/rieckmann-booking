-- FIX 3B expand: introduce real admin identity without removing legacy
-- broad authenticated policies yet. Membership in admin_users means admin.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

revoke all on public.admin_users from anon;
revoke all on public.admin_users from authenticated;
grant select on public.admin_users to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;

drop policy if exists admin_users_self_read on public.admin_users;
create policy admin_users_self_read
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

-- Future admin-aware policies. These coexist with current broad authenticated
-- policies until FIX 3 contract removes the legacy policies.
do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'appointments',
    'appointment_details',
    'patients',
    'therapists',
    'therapist_hours',
    'blocks',
    'verfuegbarzeiten',
    'hausbesuch_settings'
  ]
  loop
    policy_name := table_name || '_admin_all_expand';

    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        policy_name,
        table_name
      );
    end if;
  end loop;
end $$;
