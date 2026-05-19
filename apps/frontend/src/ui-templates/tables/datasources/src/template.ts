import * as BUI from "@thatopen/ui";
import { DataSourcesListState } from "./types";
import { DataEnhancer } from "../../../../bim-components/DataEnhancer";

export const dataSourcesListTemplate: BUI.StatefullComponent<DataSourcesListState> = (state) => {
  const { components, source } = state;

  const onCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table;
    table.loadFunction = async () => {
      const data: typeof table.data = [];
      if (!source) return data
      const enhancer = components.get(DataEnhancer);
      const sourceData = await enhancer.getSourceData(source)
      for (const entry of sourceData) {
        data.push({data: entry})
      }
      return data
    }

    if (source) {
      // "true" means it will force to load the data even if the table already have information 
      table.loadData(true).then(() => {
        // little trick for the table to calculate again
        // the columns based on the new data
        table.columns = [] 
      })
    } else {
      table.data = []
    }
  };

  return BUI.html`
    <bim-table ${BUI.ref(onCreated)}>
      <bim-label style="color: #e3874c; white-space: normal;" slot="missing-data">Select a source from the list to inspect the information.</bim-label>
    </bim-table> 
  `;
};