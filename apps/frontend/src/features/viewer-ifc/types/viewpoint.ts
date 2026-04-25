export type ViewerViewpointModelState = {
  key: string;
  name: string;
  documentPath?: string;
  documentName?: string;
  visible: boolean;
  isolated: boolean;
};

export type ViewerViewpointLoadedModel = {
  documentPath?: string;
  documentName?: string;
};

export type ViewerViewpointSelectionState = {
  modelId: string;
  expressIds: number[];
};

export type ViewerViewpoint = {
  id: string;
  name: string;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
  visibility: {
    hidden: Record<string, number[]>;
  };
  federated?: {
    loadedModels: ViewerViewpointLoadedModel[];
    modelsState: ViewerViewpointModelState[];
  };
  selection?: ViewerViewpointSelectionState[];
  display?: {
    selectedColor?: string;
    sectionBoxPadding?: number;    
  };
  snapshot?: string | null;
  coloring?: {
    color?: string;
    selection?: {
      modelId: string;
      expressIds: number[];
    }[];
  };
};