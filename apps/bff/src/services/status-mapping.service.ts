import type { WorkflowStatus, DocumentUiStatus } from "../types/status.types";

export function mapWorkflowStatusToUiStatus(
  workflowStatus: WorkflowStatus
): DocumentUiStatus {
  switch (workflowStatus) {
    case "Nuevo":
    case "Asignado":
      return "pending";

    case "En progreso":
      return "in_progress";

    case "En revisión":
    case "Respondido":
    case "Resuelto":
      return "in_review";

    case "Aprobado":
      return "approved";

    case "Rechazado":
      return "rejected";

    case "Cerrado":
      return "closed";

    default:
      return "pending";
  }
}