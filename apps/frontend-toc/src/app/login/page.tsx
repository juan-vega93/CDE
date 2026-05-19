"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function LoginPage() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-gray-600">Cargando sesión...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Acceso al portal CDE</h1>
        <p className="mt-2 text-sm text-gray-600">
          Inicia sesión con Keycloak para acceder al portal.
        </p>

        {!session ? (
          <button
            type="button"
            onClick={() => signIn("keycloak", { callbackUrl: "/" })}
            className="mt-6 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Iniciar sesión
          </button>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-gray-700">
              Sesión iniciada como{" "}
              <span className="font-medium">
                {session.user?.name || session.user?.email || "usuario"}
              </span>
            </p>

            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </main>
  );
}