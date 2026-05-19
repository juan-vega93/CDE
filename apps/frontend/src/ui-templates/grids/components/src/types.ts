import * as BUI from "@thatopen/ui";
import { DataSourcesPanelState, ItemsDataPanelState, ModelsPanelState, QueriesPanelState, SmartViewsPanelState, GisPanelState } from "../../../sections";

type Viewport = {
  name: "viewport";
  state: {};
}

export type ItemsData = {
  name: "itemsData";
  state: ItemsDataPanelState
}

export type Queries = {
  name: "queries";
  state: QueriesPanelState
}

export type DataSources = {
  name: "datasources";
  state: DataSourcesPanelState
}

export type Models = {
  name: "models";
  state: ModelsPanelState
}

export type SmartViews = {
  name: "smartViews";
  state: SmartViewsPanelState
}

export type Gis = {
  name: "gis";
  state: GisPanelState
}

type ComponentsGridElements = [Viewport, ItemsData, Models, Queries, DataSources, SmartViews, Gis];

type ComponentsGridLayouts = ["Models", "SmartViews", "Viewer", "GIS"];

export type ComponentsGrid = BUI.Grid<ComponentsGridLayouts, ComponentsGridElements>