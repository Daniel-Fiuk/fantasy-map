import { FantasyMapParams } from "./paramaters";
import { FantasyMapSettings } from "./settings";

export interface PanZoomState {
	zoom: number;
	offsetX: number;
	offsetY: number;
	minZoom: number;
	maxZoom: number;
}

export interface MapInteractionController {
	init(): void;
	setPanningEnabled(enabled: boolean): void;
	destroy(): void;
}

interface MapInteractionOptions {
	wrapper: HTMLElement;
	bgLayer: HTMLElement;
	tilesLayer: HTMLElement;
	toolbar: HTMLElement;
	parameters: FantasyMapParams;
	settings: FantasyMapSettings;
	onViewportChanged: (
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	) => void;
	onInteractionStart?: () => void;
}

export function createMapInteractionController(
	options: MapInteractionOptions
): MapInteractionController {
	return new MapInteractionManager(options);
}

class MapInteractionManager implements MapInteractionController {
	private readonly wrapper: HTMLElement;
	private readonly bgLayer: HTMLElement;
	private readonly tilesLayer: HTMLElement;
	private readonly toolbar: HTMLElement;
	private readonly parameters: FantasyMapParams;
	private readonly settings: FantasyMapSettings;
	private readonly onViewportChanged: MapInteractionOptions["onViewportChanged"];
	private readonly onInteractionStart?: () => void;

	private readonly state: PanZoomState;
	private isPanning = false;
	private panningEnabled = true;
	private lastX = 0;
	private lastY = 0;

	private readonly onPointerDown = (e: PointerEvent) => {
		if (!this.panningEnabled) return;
		if (this.toolbar.contains(e.target as Node)) return;

		this.onInteractionStart?.();

		this.isPanning = true;
		this.lastX = e.clientX;
		this.lastY = e.clientY;

		this.wrapper.setPointerCapture(e.pointerId);
	};

	private readonly onPointerMove = (e: PointerEvent) => {
		if (!this.isPanning || !this.panningEnabled) return;

		const dx = e.clientX - this.lastX;
		const dy = e.clientY - this.lastY;

		this.lastX = e.clientX;
		this.lastY = e.clientY;

		this.state.offsetX += dx;
		this.state.offsetY += dy;

		this.clampOffsets();
		this.applyTransform();
	};

	private readonly onPointerUp = () => {
		this.isPanning = false;
	};

	private readonly onWheel = (e: WheelEvent) => {
		e.preventDefault();

		const zoomStep = this.toolbar.querySelector(".fm-zoom-step") as
			| HTMLInputElement
			| null;
		const zoomValue = Number(zoomStep?.value);
		const base =
			1 +
			(isNaN(zoomValue) ? this.settings.defaultZoomIncrement : zoomValue) * 0.1;

		const factor = e.deltaY < 0 ? base : 1 / base;
		this.zoomAt(e.clientX, e.clientY, factor);
	};

	private readonly onZoomInClick = () => {
		const stepInput = this.toolbar.querySelector(".fm-zoom-step") as
			| HTMLInputElement
			| null;
		const stepValue = Number(stepInput?.value);
		const step =
			Math.abs(stepValue) ||
			this.parameters.defaultZoomIncrement ||
			this.settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		this.zoomAtViewportCenter(factorBase);
	};

	private readonly onZoomOutClick = () => {
		const stepInput = this.toolbar.querySelector(".fm-zoom-step") as
			| HTMLInputElement
			| null;
		const stepValue = Number(stepInput?.value);
		const step =
			Math.abs(stepValue) ||
			this.parameters.defaultZoomIncrement ||
			this.settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		this.zoomAtViewportCenter(1 / factorBase);
	};

	private readonly onResetClick = () => {
		this.reset();
	};

	constructor(options: MapInteractionOptions) {
		this.wrapper = options.wrapper;
		this.bgLayer = options.bgLayer;
		this.tilesLayer = options.tilesLayer;
		this.toolbar = options.toolbar;
		this.parameters = options.parameters;
		this.settings = options.settings;
		this.onViewportChanged = options.onViewportChanged;
		this.onInteractionStart = options.onInteractionStart;

		this.state = {
			zoom: this.parameters.defaultZoomLevel || 1,
			offsetX: 0,
			offsetY: 0,
			minZoom: 1,
			maxZoom: 15,
		};
	}

	init(): void {
		this.wrapper.addEventListener("pointerdown", this.onPointerDown);
		this.wrapper.addEventListener("pointermove", this.onPointerMove);
		this.wrapper.addEventListener("pointerup", this.onPointerUp);
		this.wrapper.addEventListener("wheel", this.onWheel, { passive: false });

		this.zoomInBtn?.addEventListener("click", this.onZoomInClick);
		this.zoomOutBtn?.addEventListener("click", this.onZoomOutClick);
		this.resetBtn?.addEventListener("click", this.onResetClick);

		this.reset();
	}

	setPanningEnabled(enabled: boolean): void {
		this.panningEnabled = enabled;
		if (!enabled) {
			this.isPanning = false;
		}
	}

	destroy(): void {
		this.isPanning = false;

		this.wrapper.removeEventListener("pointerdown", this.onPointerDown);
		this.wrapper.removeEventListener("pointermove", this.onPointerMove);
		this.wrapper.removeEventListener("pointerup", this.onPointerUp);
		this.wrapper.removeEventListener("wheel", this.onWheel);

		this.zoomInBtn?.removeEventListener("click", this.onZoomInClick);
		this.zoomOutBtn?.removeEventListener("click", this.onZoomOutClick);
		this.resetBtn?.removeEventListener("click", this.onResetClick);
	}

	private get zoomInBtn(): HTMLButtonElement | null {
		return this.toolbar.querySelector(".fm-zoom-in");
	}

	private get zoomOutBtn(): HTMLButtonElement | null {
		return this.toolbar.querySelector(".fm-zoom-out");
	}

	private get resetBtn(): HTMLButtonElement | null {
		return this.toolbar.querySelector(".fm-reset");
	}

	private applyTransform(): void {
		const tileWidth = this.wrapper.clientWidth * this.state.zoom;
		const tileHeight = this.wrapper.clientHeight * this.state.zoom;

		const wrappedX = (this.state.offsetX % tileWidth) - tileWidth;
		const wrappedY = (this.state.offsetY % tileHeight) - tileHeight;

		this.tilesLayer.setCssStyles({
			transform: `translate(${wrappedX}px, ${wrappedY}px) scale(${this.state.zoom})`,
			transformOrigin: "top left",
		});

		this.bgLayer.setCssStyles({
			backgroundSize: `${100 * this.state.zoom}% auto`,
			backgroundPosition: `${wrappedX}px ${wrappedY}px`,
		});

		this.onViewportChanged(
			this.state.offsetX,
			this.state.offsetY,
			tileWidth,
			tileHeight
		);
	}

	private clampOffsets(): void {
		const rect = this.wrapper.getBoundingClientRect();
		const viewW = rect.width;
		const viewH = rect.height;

		const worldW = viewW * this.state.zoom;
		const worldH = viewH * this.state.zoom;

		const repeat = this.parameters.repeat ?? "no-repeat";

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
			this.state.offsetX = Math.max(minX, Math.min(maxX, this.state.offsetX));
		}

		if (Number.isFinite(minY)) {
			this.state.offsetY = Math.max(minY, Math.min(maxY, this.state.offsetY));
		}
	}

	private reset(): void {
		this.state.zoom = this.parameters.defaultZoomLevel || 1;
		this.state.offsetX = 0;
		this.state.offsetY = 0;
		this.applyTransform();
	}

	private zoomAt(clientX: number, clientY: number, factor: number): void {
		const rect = this.wrapper.getBoundingClientRect();

		const px = clientX - rect.left;
		const py = clientY - rect.top;

		const worldX = (px - this.state.offsetX) / this.state.zoom;
		const worldY = (py - this.state.offsetY) / this.state.zoom;

		const newZoom = Math.min(
			this.state.maxZoom,
			Math.max(this.state.minZoom, this.state.zoom * factor)
		);

		this.state.offsetX = px - worldX * newZoom;
		this.state.offsetY = py - worldY * newZoom;
		this.state.zoom = newZoom;

		this.clampOffsets();
		this.applyTransform();
	}

	private zoomAtViewportCenter(zoomFactor: number): void {
		const rect = this.wrapper.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + (rect.height - this.toolbar.clientHeight) / 2;
		this.zoomAt(cx, cy, zoomFactor);
	}
}
