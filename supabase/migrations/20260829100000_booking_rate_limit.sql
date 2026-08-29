-- FIX 4B: minimal server-side booking attempt rate limit.
-- Stores only an HMAC-derived client key, never the raw client IP.

create table if not exists public.booking_rate_limits (
  key_hash text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint booking_rate_limits_key_hash_format check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint booking_rate_limits_attempts_nonnegative check (attempts >= 0)
);

alter table public.booking_rate_limits enable row level security;

revoke all on public.booking_rate_limits from anon;
revoke all on public.booking_rate_limits from authenticated;
grant select, insert, update on public.booking_rate_limits to service_role;

create or replace function public.consume_booking_rate_limit(
  p_key_hash text,
  p_max_attempts integer default 8,
  p_window_seconds integer default 600
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_window_start timestamptz;
  current_attempts integer;
  current_time timestamptz := clock_timestamp();
  window_interval interval;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_rate_limit_key' using errcode = '22023';
  end if;

  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 1000 then
    raise exception 'invalid_rate_limit_max_attempts' using errcode = '22023';
  end if;

  if p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit_window' using errcode = '22023';
  end if;

  window_interval := make_interval(secs => p_window_seconds);

  insert into public.booking_rate_limits as limits (
    key_hash,
    window_start,
    attempts,
    updated_at
  )
  values (
    p_key_hash,
    current_time,
    1,
    current_time
  )
  on conflict (key_hash) do update
    set
      window_start = case
        when limits.window_start <= current_time - window_interval then current_time
        else limits.window_start
      end,
      attempts = case
        when limits.window_start <= current_time - window_interval then 1
        else limits.attempts + 1
      end,
      updated_at = current_time
  returning window_start, attempts
    into current_window_start, current_attempts;

  allowed := current_attempts <= p_max_attempts;

  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceiling(extract(epoch from (current_window_start + window_interval - current_time)))::integer
    )
  end;

  return next;
end;
$$;

revoke all on function public.consume_booking_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_booking_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_booking_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_booking_rate_limit(text, integer, integer) to service_role;
