import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type AdminIdentity = {
  userId: string;
  email: string | null;
};

export class AdminAuthError extends Error {
  status: 401 | 403 | 500;

  constructor(status: 401 | 403 | 500, message: string) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new AdminAuthError(500, "Supabase auth is not configured");
  }

  return { supabaseUrl, anonKey };
}

async function getUserFromBearer(request: Request): Promise<User | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) return null;

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser(token);

  if (error || !user) return null;
  return user;
}

async function getUserFromCookies(): Promise<User | null> {
  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const cookieStore = await cookies();

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies; middleware refreshes them.
        }
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
}

async function isAdminUser(userId: string): Promise<boolean> {
  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AdminAuthError(500, "Admin authorization could not be verified");
  }

  return Boolean(data);
}

export async function requireAdmin(request?: Request): Promise<AdminIdentity> {
  const user = request
    ? (await getUserFromBearer(request)) ?? (await getUserFromCookies())
    : await getUserFromCookies();

  if (!user) {
    throw new AdminAuthError(401, "Authentication required");
  }

  if (!(await isAdminUser(user.id))) {
    throw new AdminAuthError(403, "Admin authorization required");
  }

  return {
    userId: user.id,
    email: user.email ?? null,
  };
}
