import { redirect } from "next/navigation";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireAdmin();
  } catch (error) {
    if (
      error instanceof AdminAuthError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect("/login");
    }

    throw error;
  }

  return children;
}
