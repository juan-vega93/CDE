import * as OBC from "@thatopen/components";
import { setupSelection } from "./selection.module";
import { setupVisibility } from "./visibility.module";
import { setupClipper } from "./clipper.module";
import { setupColoring } from "./coloring.module";
import { setupSectionBox } from "./section-box.module";
import { setupMeasurement } from "./measurement.module";
import * as OBF from "@thatopen/components-front";

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
  const bcfTopics = components.get(OBC.BCFTopics);
  const marker = components.get(OBF.Marker);
  marker.threshold = 10;
  const fastModelPickers = components.get(OBC.FastModelPickers);
 

  return {
    selection,
    visibility,
    clipper,
    coloring,
    sectionBox,
    viewpoints,
    bcfTopics,
    marker,
    fastModelPickers,
    measurement
  };
}