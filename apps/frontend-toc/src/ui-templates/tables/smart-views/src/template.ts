import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { SmartViewsListState, SmartViewsListTableData } from "./types";
import { SmartViews } from "../../../../bim-components";

export const smartViewsListTemplate: BUI.StatefullComponent<SmartViewsListState> = (state) => {  
  const { components } = state;

  const smartViews = components.get(SmartViews);
  
  const onCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table<SmartViewsListTableData>;
    const data: typeof table.data = [];
    for (const [guid, smartView] of smartViews.list) {
      data.push({
        data: {
          guid,
          Name: smartView.name,
          Actions: "",
        },
      });
    }
    table.data = data;
  };

  return BUI.html`
   <bim-table ${BUI.ref(onCreated)}></bim-table> 
  `;
};