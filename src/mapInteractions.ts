import { App } from "obsidian";
import { React } from "react";
import { updatePinPositions } from "pinInteractions";

export interface PanZoomState {
	zoom: number;
	offsetX: number;
	offsetY: number;
	minZoom: number;
	maxZoom: number;
}

let isPanning: boolean = false;
let wrapper: HTMLElement | null = null;
let lastX: number = 0;
let lastY: number = 0;

export function initMapInteractions(
	app: APP,
	wrapper: HTMLElement,
	bgLayer: HTMLElement,
	tilesLayer: HTMLElement,
	toolbar: HTMLElement,
	paramaters: FantasyMapParams,
	settings: FantasyMapSettings
) {
	const state: PanZoomState = {
		zoom: 1,
		offsetX: 0,
		offsetY: 0,
		minZoom: 1,
		maxZoom: 15
	};

	this.wrapper = wrapper;
	
	function applyTransform() {
		// size of one world tile in screen space at current zoom
		const tileWidth = wrapper.clientWidth * state.zoom;
		const tileHeight = wrapper.clientHeight * state.zoom;

		// wrap offsets so tiles never drift far off screen
		const wrappedX = (state.offsetX % tileWidth) - tileWidth;
		const wrappedY = (state.offsetY % tileHeight) - tileHeight;

		// tiles: transform via CSS scale/translate
		const transform = `translate(${wrappedX}px, ${wrappedY}px) scale(${state.zoom})`;
		tilesLayer.style.transform = transform;
		tilesLayer.style.transformOrigin = "top left";

		// background: matching zoom/pan via background-size/position
		const widthPercent = 100 * state.zoom;
		bgLayer.style.backgroundSize = `${widthPercent}% auto`;
		bgLayer.style.backgroundPosition = `${wrappedX}px ${wrappedY}px`;

		updatePinPositions(state.offsetX, state.offsetY, tileWidth, tileHeight);
	}

	function clampOffsets() {
		const rect = wrapper.getBoundingClientRect();
		const viewW = rect.width;
		const viewH = rect.height;

		const worldW = viewW * state.zoom;
		const worldH = viewH * state.zoom;

		const repeat = paramaters.repeat ?? "no-repeat";
		
		let minX = - (worldW - viewW);
		let maxX = 0;
		let minY = - (worldH - viewH);
		let maxY = 0;

		switch (repeat) {
			case "repeat-x":
				// infinite horizontally, clamped vertically
				minX = -Infinity;
				maxX = Infinity;
				break;
			case "repeat-y":
				// infinite vertically, clamped horizontally
				minY = -Infinity;
				maxY = Infinity;
				break;
			case "repeat":
			case "space":
			case "round":
				// infinite both directions
				minX = -Infinity;
				maxX = Infinity;
				minY = -Infinity;
				maxY = Infinity;
				break;
			case "no-repeat":
			default:
				// clamped both directions
				break;
		}

		if (Number.isFinite(minX)) state.offsetX = Math.max(minX, Math.min(maxX, state.offsetX));
		if (Number.isFinite(minY)) state.offsetY = Math.max(minY, Math.min(maxY, state.offsetY));
	}

	function reset() {
		state.zoom = paramaters.defaultZoomLevel || 1;
		state.offsetX = 0;
		state.offsetY = 0;
		applyTransform();
	}

	function zoomAt(clientX: number, clientY: number, factor: number) {
		const rect = wrapper.getBoundingClientRect();

		const px = clientX - rect.left;
		const py = clientY - rect.top;

		const worldX = (px - state.offsetX) / state.zoom;
		const worldY = (py - state.offsetY) / state.zoom;

		const newZoom = Math.min(
			state.maxZoom,
			Math.max(state.minZoom, state.zoom * factor)
		);

		state.offsetX = px - worldX * newZoom;
		state.offsetY = py - worldY * newZoom;
		state.zoom = newZoom;

		clampOffsets();
		applyTransform();
	}
	
	wrapper.addEventListener("pointerdown", (e) => {
		if (toolbar.contains(e.target as Node)) return;
		
		isPanning = true;
		
		lastX = e.clientX;
		lastY = e.clientY;
		
		wrapper.setPointerCapture(e.pointerId);
	});

	wrapper.addEventListener("pointermove", (e) => {
		if (!isPanning) {
			this.wrapper.releasePointerCapture(e.pointerId);
			return;
		}
		
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		
		lastX = e.clientX;
		lastY = e.clientY;
		
		state.offsetX += dx;
		state.offsetY += dy;
		
		clampOffsets();
		applyTransform();
	});
	
	wrapper.addEventListener("pointerup", async (e) => { cancelMapPanning(); });

	wrapper.addEventListener("wheel", (e) => {
		e.preventDefault();
		const zoomStep = toolbar.querySelector(".fm-zoom-step") as HTMLInputElement;
		const factor = e.deltaY < 0 ? (1 + zoomStep.value * 0.1) : 1 / (1 + zoomStep.value * 0.1);
		zoomAt(e.clientX, e.clientY, factor);
	}, { passive: false });
	
	const zoomInBtn = toolbar.querySelector(".fm-zoom-in") as HTMLButtonElement;
	const zoomOutBtn = toolbar.querySelector(".fm-zoom-out") as HTMLButtonElement;
	const resetBtn = toolbar.querySelector(".fm-reset") as HTMLButtonElement;
	
	function zoomAtViewportCenter(zoomFactor: number) {
		const rect = wrapper.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + (rect.height - toolbar.clientHeight) / 2;
		zoomAt(cx, cy, zoomFactor);
	}

	zoomInBtn?.addEventListener("click", () => {
		const stepInput = toolbar.querySelector(".fm-zoom-step") as HTMLInputElement;
		const step = Math.abs(Number(stepInput?.value)) || paramaters.defaultZoomIncrement || settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		zoomAtViewportCenter(factorBase);
	});

	zoomOutBtn?.addEventListener("click", () => {
		const stepInput = toolbar.querySelector(".fm-zoom-step") as HTMLInputElement;
		const step = Math.abs(Number(stepInput?.value)) || paramaters.defaultZoomIncrement || settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		zoomAtViewportCenter(1 / factorBase);
	});

	resetBtn?.addEventListener("click", () => reset());
	
	reset();
}

export function cancelMapPanning() {
	isPanning = false;
}
