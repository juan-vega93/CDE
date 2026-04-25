import * as OBC from "@thatopen/components";
import { setupSelection } from "./selection.module";
import { setupVisibility } from "./visibility.module";
import { setupClipper } from "./clipper.module";
import { setupColoring } from "./coloring.module";
import { setupSectionBox } from "./section-box.module";

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

  return {
    selection,
    visibility,
    clipper,
    coloring,
    sectionBox
  };
}