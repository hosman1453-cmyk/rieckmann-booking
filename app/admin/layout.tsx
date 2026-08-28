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
    if (error instanceof AdminAuthError) {
      if (error.status === 401) {
        redirect("/login");
      }

      if (error.status === 403) {
        redirect("/unauthorized");
      }
    }

    throw error;
  }

  return children;
}
