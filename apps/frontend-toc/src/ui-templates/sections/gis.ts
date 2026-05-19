import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { GisLayers } from "../../bim-components";

export interface GisPanelState {
    components: OBC.Components;
}

let onMapUpdate: any;

export const gisPanelTemplate: BUI.StatefullComponent<GisPanelState> = (
    state
) => {
    const { components } = state;
    const worlds = components.get(OBC.Worlds)
    const world = worlds.list.values().next().value as OBC.SimpleWorld;
    const camera = world.camera.three as THREE.PerspectiveCamera;
	const gisLayers = components.get(GisLayers);
	const tokenId = "that-open-cesium-token";

    const longitudeInput = BUI.Component.create<BUI.NumberInput>(() => {
	    return BUI.html`
	  <bim-number-input style="max-height: min-content;" pref="Longitude"
	  slider value="0" min="-180" max="180" step="0.0001">
	  </bim-number-input>
	`;
	});

    const latitudeInput = BUI.Component.create<BUI.NumberInput>(() => {
	    return BUI.html`
	  <bim-number-input style="max-height: min-content;" pref="Latitude"
	  slider value="0" min="-90" max="90" step="0.0001">
	  </bim-number-input>
	`;
	});

	const enableInput = BUI.Component.create<BUI.Selector>(() => {
		return BUI.html`
			<bim-selector class="disabled">
				<bim-option label="On" value="${true}"></bim-option>
				<bim-option label="Off" value="${false}" checked></bim-option>
			</bim-selector>
		`;
	});

	const updateEnableInput = (enable: boolean) => {
		if (enable) {
			enableInput.classList.remove("disabled");
		} else {
			enableInput.classList.add("disabled");
		}
	}

    const onInputToken = (e: Event) => {
	    const input = e.target as BUI.TextInput;
	    const token = input.value;
		updateEnableInput(token.length > 0);
		gisLayers.cesiumToken = token;
		localStorage.setItem(tokenId, token);
	};

    const onEnable = (e: Event) => {
	    const selector = e.target as BUI.Selector;
	    gisLayers.layer3d.enabled = selector.value;
	};

    const onLongLatChanged = () => {
	    const longitude = longitudeInput.value;
	    const latitude = latitudeInput.value;
	    gisLayers.layer2d.setMarkerPosition(longitude, latitude);
		gisLayers.layer3d.longitude = longitude;
		gisLayers.layer3d.latitude = latitude;
		gisLayers.layer3d.updateMapPosition();
	}

    const onRotationChanged = (e: Event) => {
	    const input = e.target as BUI.NumberInput;
	    gisLayers.layer3d.rotation = input.value * THREE.MathUtils.DEG2RAD;
		gisLayers.layer3d.updateMapPosition();
	}

    const onCameraRangeChanged = (e: Event) => {
	    const input = e.target as BUI.NumberInput;
	    camera.far = input.value;
	    camera.updateProjectionMatrix();
		gisLayers.layer3d.updateTiles();
	}

    longitudeInput.addEventListener("change", onLongLatChanged);
	latitudeInput.addEventListener("change", onLongLatChanged);
	enableInput.addEventListener("change", onEnable);

	const previousToken = localStorage.getItem(tokenId) || "";
	updateEnableInput(previousToken.length > 0);
	if(previousToken.length) {
		gisLayers.cesiumToken = previousToken;
	}

	if (onMapUpdate) {
		gisLayers.layer2d.onCoordinatesSelectedInMap.remove(onMapUpdate);
	}

	onMapUpdate = (data: { longitude: number, latitude: number }) => {
		const { longitude, latitude } = data;
		const factor = 1e6;
		longitudeInput.value = Math.round(longitude * factor) / factor;
		latitudeInput.value = Math.round(latitude * factor) / factor;
	}

	gisLayers.layer2d.onCoordinatesSelectedInMap.add(onMapUpdate);

    return BUI.html`
	<bim-panel-section fixed label="GIS">

        <div style="display: flex; gap: 0.5rem;">

            ${enableInput}

            <bim-text-input 
				value="${previousToken}" 
				style="max-height: min-content;" @input=${onInputToken} 
				placeholder="Insert Cesium token..." debounce="200">
			</bim-text-input>

        </div>

        <div style="display: flex; gap: 0.5rem;">

			${longitudeInput}

			${latitudeInput}

		</div>

        <bim-number-input style="max-height: min-content;" pref="Camera Range"
			slider value="${camera.far}" min="100" max="10000" step="50" @change=${onCameraRangeChanged}>
		</bim-number-input>

        <bim-number-input 
			style="max-height: min-content;" pref="Rotation" 
			slider value="0" min="0" max="360" @change=${onRotationChanged}>
		</bim-number-input>

		${gisLayers.layer2d.container}
	
	</bim-panel-section>`;
};