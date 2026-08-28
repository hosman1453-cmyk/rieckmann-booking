import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function parsePrescriptionFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const fileName = value.trim();
  const lowerFileName = fileName.toLowerCase();

  if (!fileName || fileName.length > 260) return null;
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..") ||
    lowerFileName.includes("%2e") ||
    lowerFileName.includes("%2f") ||
    lowerFileName.includes("%5c")
  ) {
    return null;
  }

  if (!/^\d{10,}_[a-zA-Z0-9._-]{1,220}$/.test(fileName)) return null;
  if (!/\.(pdf|png|jpe?g|webp|gif|heic|heif)$/i.test(fileName)) return null;

  return fileName;
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);

    const body = await request.json();
    const fileName = parsePrescriptionFileName(body?.fileName);

    if (!fileName) {
      return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.storage
      .from("prescriptions")
      .createSignedUrl(fileName, 30);

    if (error) {
      console.error("Prescription signed URL creation failed");
      return NextResponse.json(
        { error: "Document could not be loaded" },
        { status: 500 }
      );
    }

    return NextResponse.json({ signedUrl: data.signedUrl });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      if (error.status === 500) {
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }

      return NextResponse.json(
        { error: error.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: error.status }
      );
    }

    console.error("Prescription API failed");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
