import { App } from "obsidian";
import { updatePinPositions } from "./pinInteractions";
import { FantasyMapParams } from "./paramaters";
import { FantasyMapSettings } from "./settings";

export interface PanZoomState {
	zoom: number;
	offsetX: number;
	offsetY: number;
	minZoom: number;
	maxZoom: number;
}

let isPanning = false;
let lastX = 0;
let lastY = 0;

export function initMapInteractions(
	app: App,
	wrapper: HTMLElement,
	bgLayer: HTMLElement,
	tilesLayer: HTMLElement,
	toolbar: HTMLElement,
	paramaters: FantasyMapParams,
	settings: FantasyMapSettings
) {
	const state: PanZoomState = {
		zoom: paramaters.defaultZoomLevel || 1,
		offsetX: 0,
		offsetY: 0,
		minZoom: 1,
		maxZoom: 15,
	};

	function applyTransform() {
		const tileWidth = wrapper.clientWidth * state.zoom;
		const tileHeight = wrapper.clientHeight * state.zoom;

		const wrappedX = (state.offsetX % tileWidth) - tileWidth;
		const wrappedY = (state.offsetY % tileHeight) - tileHeight;

		tilesLayer.setCssStyles({
			transform: `translate(${wrappedX}px, ${wrappedY}px) scale(${state.zoom})`,
			transformOrigin: "top left",
		});

		bgLayer.setCssStyles({
			backgroundSize: `${100 * state.zoom}% auto`,
			backgroundPosition: `${wrappedX}px ${wrappedY}px`,
		});

		updatePinPositions(state.offsetX, state.offsetY, tileWidth, tileHeight);
	}

	function clampOffsets() {
		const rect = wrapper.getBoundingClientRect();
		const viewW = rect.width;
		const viewH = rect.height;

		const worldW = viewW * state.zoom;
		const worldH = viewH * state.zoom;

		const repeat = paramaters.repeat ?? "no-repeat";

		let minX = -(worldW - viewW);
		let maxX = 0;
		let minY = -(worldH - viewH);
		let maxY = 0;

		switch (repeat) {
			case "repeat-x":
				minX = -Infinity;
				maxX = Infinity;
				break;
			case "repeat-y":
				minY = -Infinity;
				maxY = Infinity;
				break;
			case "repeat":
			case "space":
			case "round":
				minX = -Infinity;
				maxX = Infinity;
				minY = -Infinity;
				maxY = Infinity;
				break;
			case "no-repeat":
			default:
				break;
		}

		if (Number.isFinite(minX)) {
			state.offsetX = Math.max(minX, Math.min(maxX, state.offsetX));
		}
		if (Number.isFinite(minY)) {
			state.offsetY = Math.max(minY, Math.min(maxY, state.offsetY));
		}
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
		if (!isPanning) return;

		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;

		lastX = e.clientX;
		lastY = e.clientY;

		state.offsetX += dx;
		state.offsetY += dy;

		clampOffsets();
		applyTransform();
	});

	wrapper.addEventListener("pointerup", () => {
		cancelMapPanning();
	});

	wrapper.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();

			const zoomStep = toolbar.querySelector(".fm-zoom-step") as HTMLInputElement;
			const zoomValue = Number(zoomStep?.value);
			const base = 1 + (isNaN(zoomValue) ? settings.defaultZoomIncrement : zoomValue) * 0.1;

			const factor = e.deltaY < 0 ? base : 1 / base;
			zoomAt(e.clientX, e.clientY, factor);
		},
		{ passive: false }
	);

	const zoomInBtn = toolbar.querySelector(".fm-zoom-in") as HTMLButtonElement | null;
	const zoomOutBtn = toolbar.querySelector(".fm-zoom-out") as HTMLButtonElement | null;
	const resetBtn = toolbar.querySelector(".fm-reset") as HTMLButtonElement | null;

	function zoomAtViewportCenter(zoomFactor: number) {
		const rect = wrapper.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + (rect.height - toolbar.clientHeight) / 2;
		zoomAt(cx, cy, zoomFactor);
	}

	zoomInBtn?.addEventListener("click", () => {
		const stepInput = toolbar.querySelector(".fm-zoom-step") as HTMLInputElement;
		const stepValue = Number(stepInput?.value);
		const step = Math.abs(stepValue) || paramaters.defaultZoomIncrement || settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		zoomAtViewportCenter(factorBase);
	});

	zoomOutBtn?.addEventListener("click", () => {
		const stepInput = toolbar.querySelector(".fm-zoom-step") as HTMLInputElement;
		const stepValue = Number(stepInput?.value);
		const step = Math.abs(stepValue) || paramaters.defaultZoomIncrement || settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		zoomAtViewportCenter(1 / factorBase);
	});

	resetBtn?.addEventListener("click", () => reset());

	reset();
}

export function cancelMapPanning() {
	isPanning = false;
}
