import * as BUI from "@thatopen/ui";
import { ComponentsGrid } from "./src";
import { viewportContainerTemplate } from "../../containers";
import { dataSourcesPanelTemplate, itemsDataPanelTemplate, modelsPanelTemplate, queriesPanelTemplate, smartViewsPanelTemplate, gisPanelTemplate } from "../../sections";
import * as OBC from "@thatopen/components";
import { MCP } from "../../../bim-components";

interface ComponentsGridState {
  components: OBC.Components
  viewport?: BUI.Viewport
}

export const componentsGridTemplate: BUI.StatefullComponent<ComponentsGridState> = (state) => {
  const { components, viewport } = state

  const mcp = components.get(MCP);
  const fragments = components.get(OBC.FragmentsManager);
  const ws = new WebSocket("ws://localhost:3001");

  ws.binaryType = "arraybuffer";

  ws.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) {
      await fragments.core.load(event.data, { modelId: "mcp" });
    } else {
      const { command, payload } = JSON.parse(event.data);
      const { modelIdMap, color, removePrevious } = payload;

      if (command === "highlight") {
        await mcp.highlight(modelIdMap, color, removePrevious);
      }
    }
  };

  const onCreated = (e?: Element) => {
    if (!e) return;
    const grid = e as ComponentsGrid;

    grid.elements = {
      viewport: {
        template: viewportContainerTemplate,
        initialState: { viewport },
      },
      itemsData: {
        template: itemsDataPanelTemplate,
        initialState: { components }
      },
      models: {
        template: modelsPanelTemplate,
        initialState: { components }
      },
      queries: {
        template: queriesPanelTemplate,
        initialState: { components }
      },
      datasources: {
        template: dataSourcesPanelTemplate,
        initialState: { components }
      },
      smartViews: {
        template: smartViewsPanelTemplate,
        initialState: { components }
      },
      gis: {
        template: gisPanelTemplate,
        initialState: { components }
      },
    };

    grid.layouts = {
      Models: {
        template: `
          "models viewport itemsData" 1fr
          "queries viewport datasources" 1fr
          /22rem 1fr 22rem
        `,
      },
      SmartViews: {
        template: `
          "viewport smartViews" 1fr
          "viewport queries" 1fr
          /1fr 22rem
        `,
      },
      Viewer: {
        template: `
          "viewport" 1fr
          /1fr
        `,
      },
      GIS: {
        template: `
          "viewport gis" 1fr
          /1fr 22rem
        `,
      },
    };

    grid.layout = "Models"
  }
  return BUI.html`<bim-grid ${BUI.ref(onCreated)} class="components-grid"></bim-grid>`
}