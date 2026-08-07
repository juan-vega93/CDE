"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bffFetch } from "@/services/bff-client";

const STATUS_OPTIONS = [
  { value: "open", label: "Abierta" },
  { value: "in_progress", label: "En curso" },
  { value: "in_review", label: "Revision" },
  { value: "closed", label: "Cerrada" }
];

type WorkflowIssueActionsProps = {
  issueId?: string;
  projectCode: string;
  status: string;
};

function normalizeStatus(value: string) {
  const normalized = value.toLowerCase();

  if (["abierta", "nuevo", "new"].includes(normalized)) return "open";
  if (["en curso", "asignado"].includes(normalized)) return "in_progress";
  if (["revision", "en revision", "en revisión", "in_review"].includes(normalized)) {
    return "in_review";
  }
  if (["cerrada", "cerrado", "closed", "resuelto", "resolved"].includes(normalized)) {
    return "closed";
  }

  return normalized || "open";
}

export function WorkflowIssueActions({
  issueId,
  projectCode,
  status
}: WorkflowIssueActionsProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!issueId) {
    return null;
  }

  const resolvedIssueId = issueId;

  async function updateStatus(nextStatus: string) {
    setError("");

    const response = await bffFetch(`/api/issues/${encodeURIComponent(resolvedIssueId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        projectCode,
        status: nextStatus
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "No se pudo actualizar la incidencia");
    }
  }

  async function deleteIssue() {
    setError("");

    const params = new URLSearchParams({ projectCode });
    const response = await bffFetch(
      `/api/issues/${encodeURIComponent(resolvedIssueId)}?${params.toString()}`,
      {
        method: "DELETE"
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "No se pudo eliminar la incidencia");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select
          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
          defaultValue={normalizeStatus(status)}
          disabled={isPending}
          onChange={(event) => {
            const nextStatus = event.currentTarget.value;

            startTransition(async () => {
              try {
                await updateStatus(nextStatus);
                router.refresh();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "No se pudo actualizar la incidencia"
                );
              }
            });
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="rounded border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              try {
                await deleteIssue();
                router.refresh();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "No se pudo eliminar la incidencia"
                );
              }
            });
          }}
        >
          Eliminar
        </button>
      </div>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
