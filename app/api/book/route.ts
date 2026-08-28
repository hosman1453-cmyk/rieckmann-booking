import { NextResponse } from "next/server";
import {
  ALL_VALID_SERVICES,
  type BlockedRange,
  type BookedEntry,
  type HausbesuchSetting,
  VALID_INSURANCE,
  gesetzlicheServices,
  type Therapist,
  type TherapistHours,
  type Verfuegbar,
  getDisplaySlot,
  getRequiredSlots,
  hasTimeConflict,
  insuranceToHbRegion,
  isAllowedDate,
  isSlotBlocked,
  isSlotInWorkingHours,
  hausbesuchServices,
  privateServices,
  sanitizeEmail,
  sanitizePhone,
  sanitizeText,
  selbstzahlerServices,
  validateName,
} from "@/lib/booking-rules";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type BookingRequest = {
  insurance?: unknown;
  serviceTitle?: unknown;
  appointments?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  dsgvo?: unknown;
  prescriptionUrls?: unknown;
};

type RequestedAppointment = {
  date: string;
  time: string;
  therapistId: number;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAppointments(value: unknown): RequestedAppointment[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;

  const parsed: RequestedAppointment[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const allowedItemKeys = new Set(["date", "time", "therapistId"]);
    if (Object.keys(item).some((key) => !allowedItemKeys.has(key))) return null;
    const date = typeof item.date === "string" ? item.date : "";
    const time = typeof item.time === "string" ? item.time : "";
    const therapistId = Number(item.therapistId);

    if (!isAllowedDate(date)) return null;
    if (!Number.isInteger(therapistId) || therapistId <= 0) return null;
    if (!/^\d{2}:\d{2}\s-\s\d{2}:\d{2}$/.test(time)) return null;

    parsed.push({ date, time, therapistId });
  }

  return parsed;
}

function parsePrescriptionUrls(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) return null;
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > 1000) return null;
    urls.push(item);
  }
  return urls;
}

export async function POST(request: Request) {
  let body: BookingRequest;
  try {
    const parsed = await request.json();
    if (!isPlainObject(parsed)) return jsonError("Invalid booking data", 400);
    body = parsed;
  } catch {
    return jsonError("Invalid booking data", 400);
  }

  const allowedKeys = new Set([
    "insurance",
    "serviceTitle",
    "appointments",
    "name",
    "email",
    "phone",
    "message",
    "dsgvo",
    "prescriptionUrls",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return jsonError("Invalid booking data", 400);
  }

  const insurance = typeof body.insurance === "string" ? body.insurance : "";
  if (!VALID_INSURANCE.includes(insurance as never)) {
    return jsonError("Invalid booking data", 400);
  }

  const serviceTitle = typeof body.serviceTitle === "string" ? body.serviceTitle : "";
  const validService = ALL_VALID_SERVICES.find((service) => service.title === serviceTitle);
  if (!validService) {
    return jsonError("Invalid booking data", 400);
  }

  const isHausbesuch = insurance.startsWith("hausbesuch");
  const allowedServices = isHausbesuch
    ? hausbesuchServices
    : insurance === "gesetzlich"
      ? gesetzlicheServices
      : insurance === "privat"
        ? privateServices
        : selbstzahlerServices;
  if (!allowedServices.some((service) => service.title === validService.title)) {
    return jsonError("Invalid booking data", 400);
  }

  const hausbesuchRegion = insuranceToHbRegion(insurance);
  if (isHausbesuch && !hausbesuchRegion) {
    return jsonError("Invalid booking data", 400);
  }
  if (isHausbesuch && ![40, 60].includes(Number.parseInt(validService.duration, 10)) && validService.duration !== "1 Std.") {
    return jsonError("Invalid booking data", 400);
  }

  const requiredSlots = getRequiredSlots(validService.duration, isHausbesuch);
  if (![1, 2, 3].includes(requiredSlots)) {
    return jsonError("Invalid booking data", 400);
  }

  const rawName = typeof body.name === "string" ? body.name : "";
  if (!validateName(rawName)) {
    return jsonError("Invalid booking data", 400);
  }

  const validEmail = sanitizeEmail(typeof body.email === "string" ? body.email : "");
  if (!validEmail) {
    return jsonError("Invalid booking data", 400);
  }

  const safePhone = sanitizePhone(typeof body.phone === "string" ? body.phone : "");
  if (!safePhone) {
    return jsonError("Invalid booking data", 400);
  }

  const safeMessage =
    typeof body.message === "string" && body.message.trim()
      ? sanitizeText(body.message).slice(0, 2000)
      : null;

  if (body.dsgvo !== true) {
    return jsonError("Invalid booking data", 400);
  }

  const requestedAppointments = parseAppointments(body.appointments);
  if (!requestedAppointments) {
    return jsonError("Invalid booking data", 400);
  }

  const prescriptionUrls = parsePrescriptionUrls(body.prescriptionUrls);
  if (!prescriptionUrls) {
    return jsonError("Invalid booking data", 400);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const uniqueDates = [...new Set(requestedAppointments.map((appointment) => appointment.date))];
    const therapistIds = [...new Set(requestedAppointments.map((appointment) => appointment.therapistId))];

    const [
      therapistsResult,
      hoursResult,
      verfuegbarResult,
      hausbesuchResult,
      blocksResult,
    ] = await Promise.all([
      supabase.from("therapists").select("id,name,active").in("id", therapistIds),
      supabase.from("therapist_hours").select("therapist_id,day_of_week,start_time,end_time,is_working").in("therapist_id", therapistIds),
      supabase.from("verfuegbarzeiten").select("therapist_id,day_of_week,start_time,end_time,is_available").in("therapist_id", therapistIds),
      supabase.from("hausbesuch_settings").select("therapist_id,region,day_of_week,start_time,end_time,is_active").in("therapist_id", therapistIds),
      supabase.from("blocks").select("therapist_id,date,start_time,end_time").in("date", uniqueDates).in("therapist_id", therapistIds),
    ]);

    if (
      therapistsResult.error ||
      hoursResult.error ||
      verfuegbarResult.error ||
      hausbesuchResult.error ||
      blocksResult.error
    ) {
      console.error("Booking validation lookup failed");
      return jsonError("Booking could not be validated", 500);
    }

    const therapists = (therapistsResult.data ?? []) as Therapist[];
    const hours = (hoursResult.data ?? []) as TherapistHours[];
    const verfuegbar = (verfuegbarResult.data ?? []) as Verfuegbar[];
    const hausbesuchSettings = (hausbesuchResult.data ?? []) as HausbesuchSetting[];
    const blocks = (blocksResult.data ?? []) as BlockedRange[];

    const seenBookings: BookedEntry[] = [];
    const rpcDates: string[] = [];
    const rpcTimes: string[] = [];
    const rpcTherapistIds: number[] = [];

    for (const requested of requestedAppointments) {
      const therapist = therapists.find((candidate) => candidate.id === requested.therapistId && candidate.active === true);
      if (!therapist) {
        return jsonError("Requested therapist is unavailable", 400);
      }

      const displayTime = getDisplaySlot(requested.time, requiredSlots, isHausbesuch);
      if (!/^\d{2}:\d{2}\s-\s\d{2}:\d{2}$/.test(displayTime)) {
        return jsonError("Invalid booking data", 400);
      }

      const inWorkingHours = isSlotInWorkingHours(
        requested.time,
        requiredSlots,
        requested.therapistId,
        requested.date,
        verfuegbar,
        hours,
        isHausbesuch,
        hausbesuchSettings,
        hausbesuchRegion,
      );
      if (!inWorkingHours) {
        return jsonError("Requested slot is unavailable", 409);
      }

      if (isSlotBlocked(requested.time, requiredSlots, requested.therapistId, requested.date, blocks, isHausbesuch)) {
        return jsonError("Requested slot is unavailable", 409);
      }

      if (hasTimeConflict(requested.therapistId, requested.date, displayTime, seenBookings)) {
        return jsonError("Requested slot is unavailable", 409);
      }

      seenBookings.push({
        therapist_id: requested.therapistId,
        date: requested.date,
        time: displayTime,
      });

      rpcDates.push(requested.date);
      rpcTimes.push(displayTime);
      rpcTherapistIds.push(requested.therapistId);
    }

    const { data: insertedAppointments, error: bookingError } = await supabase.rpc("create_public_booking", {
      p_name: sanitizeText(rawName.trim()),
      p_email: validEmail,
      p_phone: safePhone,
      p_service: validService.title,
      p_insurance: insurance,
      p_message: safeMessage,
      p_privacy_accepted: true,
      p_prescription_files: prescriptionUrls,
      p_dates: rpcDates,
      p_times: rpcTimes,
      p_therapist_ids: rpcTherapistIds,
    });

    if (bookingError) {
      if (bookingError.code === "23P01" || bookingError.message === "booking_conflict") {
        return jsonError("Requested slot is no longer available", 409);
      }
      console.error("Booking RPC failed");
      return jsonError("Booking could not be created", 500);
    }

    return NextResponse.json({ count: insertedAppointments.length });
  } catch {
    console.error("Booking route failed");
    return jsonError("Booking could not be created", 500);
  }
}
