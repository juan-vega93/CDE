export type WorkflowStatus =
  | "Nuevo"
  | "Asignado"
  | "En progreso"
  | "En revisión"
  | "Respondido"
  | "Resuelto"
  | "Aprobado"
  | "Rechazado"
  | "Cerrado";

export type DocumentUiStatus =
  | "pending"
  | "in_progress"
  | "in_review"
  | "approved"
  | "rejected"
  | "closed";