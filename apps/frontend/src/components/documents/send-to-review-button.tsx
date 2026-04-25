"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendToReview } from "@/services/documents.service";

type SendToReviewButtonProps = {
  documentId: string;
  documentPath: string;
  documentName: string;
  projectId: number;
  typeId: number;
  isAlreadyLinked?: boolean;
};

export function SendToReviewButton({
  documentId,
  documentPath,
  documentName,
  projectId,
  typeId,
  isAlreadyLinked = false
}: SendToReviewButtonProps) {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSendToReview() {
    if (isAlreadyLinked) {
      return;
    }

    try {
      setIsLoading(true);
      setMessage(null);
      setError(null);

      const result = await sendToReview({
        documentId,
        documentPath,
        documentName,
        projectId,
        typeId,
        subject: `Revisión de ${documentName}`,
        description: `Enviar documento ${documentName} a revisión técnica`,
        assigneeId: 23,
        dueDate: "2026-04-05"
      });

      setMessage(
        `Revisión creada. WP #${result.data.workPackage.id} vinculado correctamente.`
      );

      router.refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Ocurrió un error inesperado";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  if (isAlreadyLinked) {
    return (
      <div className="flex flex-col gap-2">
        <button
          disabled
          className="cursor-not-allowed rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-500"
        >
          Ya enviado a revisión
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleSendToReview}
        disabled={isLoading}
        className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? "Enviando..." : "Enviar a revisión"}
      </button>

      {message ? (
        <p className="text-sm text-green-700">{message}</p>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}