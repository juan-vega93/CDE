import * as OBC from "@thatopen/components";
import { setupSelection } from "./selection.module";
import { setupVisibility } from "./visibility.module";
import { setupClipper } from "./clipper.module";
import { setupColoring } from "./coloring.module";
import { setupSectionBox } from "./section-box.module";
import { setupMeasurement } from "./measurement.module";
import * as OBF from "@thatopen/components-front";
import { createSelectionContext } from "../lib/selection-context";

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
    models: () => fragments.list,
    hidden: () => components.get(OBC.Hider).getVisibilityMap(false),
    refresh: async () => { await fragments.core.update(true); }
  });
  selection.setCommitListener(presentation => context.setSelection(
    presentation === "context" ? selection.getSelectionModelIdMap() : {}
  ));
  visibility.subscribe(() => { void visibility.reconcile().then(() => context.reconcile()).catch(console.warn); });

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
