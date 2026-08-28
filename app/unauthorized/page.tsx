import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">
          Kein Administratorzugriff
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Dieses Konto ist angemeldet, hat aber keine Berechtigung fuer den
          Administrationsbereich.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Zur Anmeldung
        </Link>
      </section>
    </main>
  );
}
