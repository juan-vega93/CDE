/** Tipos DTO para comunicación con la BCF API 2.1 de OpenProject */

export type OpenProjectBcfProject = {
  project_id: string;
  name: string;
};

/** Topic BCF 2.1 según lo que devuelve/espera OpenProject */
export type OpenProjectBcfTopic = {
  guid: string;
  topic_type?: string;
  topic_status?: string;
  priority?: string;
  title: string;
  description?: string;
  creation_date?: string;
  creation_author?: string;
  modified_date?: string;
  modified_author?: string;
  assigned_to?: string;
  labels?: string[];
  reference_links?: string[];
  due_date?: string;
  stage?: string;
};

export type OpenProjectBcfComment = {
  guid: string;
  verbal_status?: string;
  status?: string;
  date?: string;
  author?: string;
  comment?: string;
  modified_date?: string;
  modified_author?: string;
  viewpoint_guid?: string;
};

export type OpenProjectBcfViewpointInput = {
  snapshot?: {
    snapshot_type: "png";
    snapshot_data: string; // base64
  };
  /** Opcional: componentes seleccionados vía ifc_guid */
  components?: {
    selection?: Array<{
      ifc_guid: string;
    }>;
    visibility?: {
      default_visibility?: boolean;
    };
  };
  perspective_camera?: {
    camera_view_point?: { x: number; y: number; z: number };
    camera_direction?: { x: number; y: number; z: number };
    camera_up_vector?: { x: number; y: number; z: number };
    field_of_view?: number;
  };
};

export type OpenProjectBcfViewpoint = {
  guid: string;
  viewpoint?: string; // URL
  snapshot?: {
    snapshot_type: string;
    snapshot_data?: string;
    snapshot_uri?: string;
  };
  index?: number;
};

/** Resultados de operaciones de sincronización */
export type BcfSyncResult = {
  ok: boolean;
  openProject?: {
    projectId?: string;
    topicGuid?: string;
    href?: string;
    lastSyncedAt?: string;
    lastSyncedHash?: string;
  };
  warnings: string[];
  errors: string[];
};

export type BcfSyncConflict = {
  localTopic: unknown;
  remoteTopic: unknown;
  detectedAt: string;
  reason: string;
};