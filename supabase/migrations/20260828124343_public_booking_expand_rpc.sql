-- FIX 2F expand: add the trusted-server atomic booking RPC.
-- This migration intentionally does not remove existing anonymous table
-- policies, so the currently deployed browser-direct booking flow remains
-- compatible until the new application code is deployed.

create or replace function public.create_public_booking(
  p_name text,
  p_email text,
  p_phone text,
  p_service text,
  p_insurance text,
  p_message text,
  p_privacy_accepted boolean,
  p_prescription_files jsonb,
  p_dates date[],
  p_times text[],
  p_therapist_ids bigint[]
)
returns table(appointment_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i integer;
  requested_start time;
  requested_end time;
  existing record;
  existing_start time;
  existing_end time;
  inserted_id uuid;
  lock_key text;
  prescription_urls_udt text;
  prescription_url_texts text[];
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'invalid_booking_name' using errcode = '22023';
  end if;

  if p_email is null or btrim(p_email) = '' then
    raise exception 'invalid_booking_email' using errcode = '22023';
  end if;

  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'invalid_booking_phone' using errcode = '22023';
  end if;

  if p_service is null or btrim(p_service) = '' then
    raise exception 'invalid_booking_service' using errcode = '22023';
  end if;

  if p_insurance is null or btrim(p_insurance) = '' then
    raise exception 'invalid_booking_insurance' using errcode = '22023';
  end if;

  if p_privacy_accepted is distinct from true then
    raise exception 'privacy_required' using errcode = '22023';
  end if;

  if p_prescription_files is not null and jsonb_typeof(p_prescription_files) <> 'array' then
    raise exception 'invalid_prescription_files' using errcode = '22023';
  end if;

  if p_dates is null or p_times is null or p_therapist_ids is null then
    raise exception 'invalid_booking_appointments' using errcode = '22023';
  end if;

  select c.udt_name
    into prescription_urls_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'appointment_details'
    and c.column_name = 'prescription_urls';

  if prescription_urls_udt is null then
    raise exception 'appointment_details_schema_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(value), array[]::text[])
    into prescription_url_texts
  from jsonb_array_elements_text(coalesce(p_prescription_files, '[]'::jsonb)) as urls(value);

  if array_length(p_dates, 1) is null
    or array_length(p_dates, 1) <> array_length(p_times, 1)
    or array_length(p_dates, 1) <> array_length(p_therapist_ids, 1)
    or array_length(p_dates, 1) > 10
  then
    raise exception 'invalid_booking_appointments' using errcode = '22023';
  end if;

  for i in 1..array_length(p_dates, 1) loop
    if p_dates[i] is null or p_times[i] is null or p_therapist_ids[i] is null then
      raise exception 'invalid_booking_appointment' using errcode = '22023';
    end if;

    if p_times[i] !~ '^\d{2}:\d{2} - \d{2}:\d{2}$' then
      raise exception 'invalid_booking_time' using errcode = '22023';
    end if;

    begin
      requested_start := split_part(p_times[i], ' - ', 1)::time;
      requested_end := split_part(p_times[i], ' - ', 2)::time;
    exception when others then
      raise exception 'invalid_booking_time' using errcode = '22023';
    end;

    if requested_end <= requested_start then
      raise exception 'invalid_booking_time' using errcode = '22023';
    end if;

    lock_key := p_therapist_ids[i]::text || ':' || p_dates[i]::text;
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

    for existing in
      select id, time
      from public.appointments
      where therapist_id = p_therapist_ids[i]
        and date = p_dates[i]
    loop
      if existing.time is null or existing.time !~ '^\d{2}:\d{2} - \d{2}:\d{2}$' then
        raise exception 'existing_booking_time_invalid' using errcode = '22023';
      end if;

      begin
        existing_start := split_part(existing.time, ' - ', 1)::time;
        existing_end := split_part(existing.time, ' - ', 2)::time;
      exception when others then
        raise exception 'existing_booking_time_invalid' using errcode = '22023';
      end;

      if existing_end <= existing_start then
        raise exception 'existing_booking_time_invalid' using errcode = '22023';
      end if;

      if existing_start < requested_end and existing_end > requested_start then
        raise exception 'booking_conflict' using errcode = '23P01';
      end if;
    end loop;

    insert into public.appointments (
      name,
      email,
      phone,
      service,
      insurance,
      message,
      privacy_accepted,
      prescription_files,
      date,
      time,
      therapist_id
    )
    values (
      p_name,
      p_email,
      p_phone,
      p_service,
      p_insurance,
      nullif(p_message, ''),
      true,
      coalesce(p_prescription_files, '[]'::jsonb),
      p_dates[i],
      p_times[i],
      p_therapist_ids[i]
    )
    returning id into inserted_id;

    if prescription_urls_udt = 'jsonb' then
      execute
        'insert into public.appointment_details (
          appointment_id,
          patient_name,
          patient_email,
          patient_phone,
          message,
          dsgvo_accepted,
          prescription_urls
        ) values ($1, $2, $3, $4, $5, true, $6)'
      using
        inserted_id,
        p_name,
        p_email,
        p_phone,
        nullif(p_message, ''),
        case
          when p_prescription_files is null or jsonb_array_length(p_prescription_files) = 0 then null
          else p_prescription_files
        end;
    elsif prescription_urls_udt = '_text' then
      execute
        'insert into public.appointment_details (
          appointment_id,
          patient_name,
          patient_email,
          patient_phone,
          message,
          dsgvo_accepted,
          prescription_urls
        ) values ($1, $2, $3, $4, $5, true, $6)'
      using
        inserted_id,
        p_name,
        p_email,
        p_phone,
        nullif(p_message, ''),
        case
          when cardinality(prescription_url_texts) = 0 then null
          else prescription_url_texts
        end;
    else
      raise exception 'appointment_details_schema_invalid' using errcode = '22023';
    end if;

    appointment_id := inserted_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_public_booking(
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  date[],
  text[],
  bigint[]
) from public;

revoke all on function public.create_public_booking(
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  date[],
  text[],
  bigint[]
) from anon;

revoke all on function public.create_public_booking(
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  date[],
  text[],
  bigint[]
) from authenticated;

grant execute on function public.create_public_booking(
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  date[],
  text[],
  bigint[]
) to service_role;
