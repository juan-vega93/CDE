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
  const appliedManualStyles = new Set<string>();

  function isEmptyModelIdMap(modelIdMap: OBC.ModelIdMap) {
    return Object.keys(modelIdMap).length === 0;
  }

  function getManualColorStyle(color: string) {
    const normalizedColor = color.trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    return `${MANUAL_COLOR_STYLE}-${normalizedColor || "default"}`;
  }

  function setManualColorStyle(color: string) {
    const styleName = getManualColorStyle(color);

    highlighter.styles.set(styleName, {
      color: new THREE.Color(color),
      opacity: 1,
      transparent: false,
      renderedFaces: 0
    });
    appliedManualStyles.add(styleName);

    return styleName;
  }

  function cloneModelIdMap(modelIdMap: OBC.ModelIdMap): OBC.ModelIdMap {
    const clone: OBC.ModelIdMap = {};

    for (const [modelId, ids] of Object.entries(modelIdMap)) {
      clone[modelId] = new Set(ids);
    }

    return clone;
  }

  async function colorSelection(modelIdMap: OBC.ModelIdMap, color: string) {
    if (isEmptyModelIdMap(modelIdMap)) return false;

    const styleName = setManualColorStyle(color);

    await highlighter.highlightByID(styleName, modelIdMap, false);
    await highlighter.clear("select");

    return true;
  }

  async function colorSelections(
    entries: Array<{ modelIdMap: OBC.ModelIdMap; color: string }>
  ) {
    const nonEmptyEntries = entries.filter(
      (entry) => !isEmptyModelIdMap(entry.modelIdMap)
    );

    if (nonEmptyEntries.length === 0) return false;

    await restoreAllColors();

    for (const entry of nonEmptyEntries) {
      const styleName = setManualColorStyle(entry.color);
      highlighter.selection[styleName] = cloneModelIdMap(entry.modelIdMap);
    }

    await highlighter.clear("select");
    await highlighter.updateColors();

    return true;
  }

  async function restoreSelectionColor(modelIdMap: OBC.ModelIdMap) {
    if (isEmptyModelIdMap(modelIdMap)) return false;

    for (const styleName of appliedManualStyles) {
      await highlighter.clear(styleName, modelIdMap);
    }
    await highlighter.clear("select");

    return true;
  }

  async function restoreAllColors() {
    for (const styleName of appliedManualStyles) {
      await highlighter.clear(styleName);
    }
    appliedManualStyles.clear();
    await highlighter.clear("select");
  }

  return {
    colorSelection,
    colorSelections,
    restoreSelectionColor,
    restoreAllColors
  };
}
