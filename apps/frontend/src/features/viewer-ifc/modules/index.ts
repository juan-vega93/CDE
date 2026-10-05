import * as OBC from "@thatopen/components";
import { setupSelection } from "./selection.module";
import { setupVisibility } from "./visibility.module";
import { setupClipper } from "./clipper.module";
import { setupColoring } from "./coloring.module";
import { setupSectionBox } from "./section-box.module";
import { setupMeasurement } from "./measurement.module";
import * as OBF from "@thatopen/components-front";
import { createSelectionContext } from "../lib/selection-context";
import { createSelectionMaterialBridge } from "../lib/selection-materials";
import { createSelectionOpacityModel } from "../lib/selection-opacity";

type SetupViewerModulesParams = {
  components: OBC.Components;
  world: OBC.World;
};

export function setupViewerModules({
  components,
  world
}: SetupViewerModulesParams) {
  const selection = setupSelection({
    components,
    world
  });

  const visibility = setupVisibility({
    components
  });
  const fragments = components.get(OBC.FragmentsManager);
  const context = createSelectionContext({
    models: () => Array.from(fragments.list,([id,model])=>[id,createSelectionOpacityModel(model,id,selection.highlighter)] as const),
    hidden: () => components.get(OBC.Hider).getVisibilityMap(false),
    refresh: async () => { await fragments.core.update(true); }
  });
  selection.setCommitListener(presentation => context.setSelection(
    presentation === "context" ? selection.getSelectionModelIdMap() : {}
  ));
  // All material rebuilds (including SmartView/color operations) invalidate
  // opacity overrides. Reconcile only after the library's writes have settled.
  const updateColors = selection.highlighter.updateColors.bind(selection.highlighter);
  const resetHighlight = fragments.resetHighlight.bind(fragments);
  const materials = createSelectionMaterialBridge({selections:()=>selection.highlighter.selection,reset:resetHighlight});
  selection.highlighter.updateColors = () => context.rebuildMaterials(async()=>{
    let changed:OBC.ModelIdMap={};
    const reset=fragments.resetHighlight;
    fragments.resetHighlight=async map=>{
      if(map) return resetHighlight(map);
      changed=await materials.reset();
    };
    try {await updateColors();} finally {fragments.resetHighlight=reset;}
    return changed;
  },selection.isCommittingPresentation);
  visibility.subscribe(() => { void visibility.reconcile().then(() => context.reconcile()).catch(console.warn); });
  fragments.list.onItemDeleted.add(() => { void context.reconcile().catch(console.warn); });

  const clipper = setupClipper({
    components,
    world
  });

  const coloring = setupColoring({
    components
  });

  const sectionBox = setupSectionBox({
    components,
    world
  });

  const measurement = setupMeasurement({
  components,
  world
});


  const viewpoints = components.get(OBC.Viewpoints);
  const views = components.get(OBC.Views);
  views.world = world;
  const bcfTopics = components.get(OBC.BCFTopics);
  const marker = components.get(OBF.Marker);
  marker.threshold = 10;
  const fastModelPickers = components.get(OBC.FastModelPickers);
 

  return {
    selection,
    context,
    visibility,
    clipper,
    coloring,
    sectionBox,
    viewpoints,
    views,
    bcfTopics,
    marker,
    fastModelPickers,
    measurement
  };
}
