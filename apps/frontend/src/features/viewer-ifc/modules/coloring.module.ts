"use client";

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

type SetupColoringParams = {
  components: OBC.Components;
};

const MANUAL_COLOR_STYLE = "manual-color";

export function setupColoring({ components }: SetupColoringParams) {
  const highlighter = components.get(OBF.Highlighter);

  function isEmptyModelIdMap(modelIdMap: OBC.ModelIdMap) {
    return Object.keys(modelIdMap).length === 0;
  }

  function setManualColorStyle(color: string) {
    highlighter.styles.set(MANUAL_COLOR_STYLE, {
      color: new THREE.Color(color),
      opacity: 1,
      transparent: false,
      renderedFaces: 0
    });
  }

  async function colorSelection(modelIdMap: OBC.ModelIdMap, color: string) {
    if (isEmptyModelIdMap(modelIdMap)) return false;

    setManualColorStyle(color);

    await highlighter.highlightByID(MANUAL_COLOR_STYLE, modelIdMap, false);
    await highlighter.clear("select");

    return true;
  }

  async function restoreSelectionColor(modelIdMap: OBC.ModelIdMap) {
    if (isEmptyModelIdMap(modelIdMap)) return false;

    await highlighter.clear(MANUAL_COLOR_STYLE, modelIdMap);
    await highlighter.clear("select");

    return true;
  }

  async function restoreAllColors() {
    await highlighter.clear(MANUAL_COLOR_STYLE);
    await highlighter.clear("select");
  }

  return {
    colorSelection,
    restoreSelectionColor,
    restoreAllColors
  };
}