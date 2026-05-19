"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { provisionUser } from "@/services/admin-users.service";
import { canManageUsers } from "@/lib/rbac";

const ROLE_OPTIONS = [
  "viewer",
  "doc-controller",
  "discipline-lead",
  "bim-coordinator",
  "bim-manager"
];

export default function AdminUsersPage() {
  const { data: session, status } = useSession();

  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    username: "",
    password: "",
    groupName: "",
    roleName: "viewer"
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function updateField(field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      [field]: value
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setSuccessMessage("");
    setErrorMessage("");

    try {
      const result = await provisionUser({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        username: form.username.trim(),
        password: form.password.trim() || undefined,
        groupName: form.groupName.trim(),
        roleName: form.roleName
      });

      setSuccessMessage(
        `Usuario provisionado correctamente: ${result?.data?.email || form.email}`
      );

      setForm({
        email: "",
        firstName: "",
        lastName: "",
        username: "",
        password: "",
        groupName: "",
        roleName: "viewer"
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo provisionar el usuario"
      );
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") {
    return <main className="mx-auto max-w-3xl p-8">Cargando...</main>;
  }

  if (!canManageUsers(session?.roles)) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Acceso restringido</h1>
          <p className="mt-2 text-sm text-gray-600">
            No tienes permisos para administrar usuarios.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Provisionamiento de usuarios
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Crea usuarios y sincroniza identidad, grupo y rol base con Keycloak, Nextcloud y OpenProject.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Correo
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
              placeholder="usuario@empresa.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Nombre
            </label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
              placeholder="Juan"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Apellido
            </label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
              placeholder="Pérez"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Username
            </label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => updateField("username", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
              placeholder="juan.perez"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Contraseña inicial
            </label>
            <input
              type="text"
              value={form.password}
              onChange={(e) => updateField("password", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
              placeholder="Temporal123!"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Grupo
            </label>
            <input
              type="text"
              value={form.groupName}
              onChange={(e) => updateField("groupName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
              placeholder="ARQ"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Rol
            </label>
            <select
              value={form.roleName}
              onChange={(e) => updateField("roleName", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Provisionando..." : "Provisionar usuario"}
            </button>

            {successMessage ? (
              <p className="text-sm text-green-600">{successMessage}</p>
            ) : null}

            {errorMessage ? (
              <p className="text-sm text-red-600">{errorMessage}</p>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
}