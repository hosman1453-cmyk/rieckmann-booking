import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonError("Invalid date", 400);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [appointmentsResult, blocksResult] = await Promise.all([
      supabase
        .from("appointments")
        .select("therapist_id,date,time")
        .eq("date", date),
      supabase
        .from("blocks")
        .select("therapist_id,date,start_time,end_time")
        .eq("date", date),
    ]);

    if (appointmentsResult.error || blocksResult.error) {
      console.error("Availability lookup failed");
      return jsonError("Availability could not be loaded", 500);
    }

    return NextResponse.json({
      booked: appointmentsResult.data ?? [],
      blocks: blocksResult.data ?? [],
    });
  } catch {
    console.error("Availability route failed");
    return jsonError("Availability could not be loaded", 500);
  }
}