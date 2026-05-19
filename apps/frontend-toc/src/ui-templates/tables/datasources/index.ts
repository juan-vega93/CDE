import * as BUI from "@thatopen/ui";
import { DataSourcesListState } from "./src/types";
import { dataSourcesListTemplate } from "./src/template";
import { setDefaults } from "./src/set-defaults";

export const dataSourcesList = (state: DataSourcesListState) => {
  const component = BUI.Component.create<BUI.Table, DataSourcesListState>(dataSourcesListTemplate, state);
  return component
};
