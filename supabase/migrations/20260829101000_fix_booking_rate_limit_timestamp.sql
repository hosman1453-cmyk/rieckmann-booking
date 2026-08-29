-- FIX 4E: correct rate-limit RPC clock type.
-- Keeps the public function contract unchanged and replaces current_time usage
-- with an explicit timestamptz variable.

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
  v_now timestamptz := now();
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
    v_now,
    1,
    v_now
  )
  on conflict (key_hash) do update
    set
      window_start = case
        when limits.window_start <= v_now - window_interval then v_now
        else limits.window_start
      end,
      attempts = case
        when limits.window_start <= v_now - window_interval then 1
        else limits.attempts + 1
      end,
      updated_at = v_now
  returning window_start, attempts
    into current_window_start, current_attempts;

  allowed := current_attempts <= p_max_attempts;

  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceiling(extract(epoch from (current_window_start + window_interval - v_now)))::integer
    )
  end;

  return next;
end;
$$;

revoke all on function public.consume_booking_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_booking_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_booking_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_booking_rate_limit(text, integer, integer) to service_role;
