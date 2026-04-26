import type { SimpleMapParamaters } from "./paramaters";
import type { SimpleMapSettings } from "./settings";

// Manages panning and zooming interactions for the simple map
export interface PanZoomState {
	zoom: number;
	offsetX: number;
	offsetY: number;
	minZoom: number;
	maxZoom: number;
}

// Interface for the map interaction controller, defining methods for initialization, enabling/disabling panning, and cleanup
export interface MapInteractionController {
	init(): void;
	setPanningEnabled(enabled: boolean): void;
	centerOnLocation(lat: number, lng: number): void;
	destroy(): void;
}

// Options for creating the map interaction controller, including references to DOM elements, map parameters, settings, and callback functions for viewport changes and interaction start
interface MapInteractionOptions {
	wrapper: HTMLElement;
	bgLayer: HTMLElement;
	tilesLayer: HTMLElement;
	toolbar: HTMLElement;
	parameters: SimpleMapParamaters;
	settings: SimpleMapSettings;
	onViewportChanged: (
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	) => void;
	onInteractionStart?: () => void;
}

// Factory function to create a new instance of the MapInteractionController with the provided options
export function createMapInteractionController(
	options: MapInteractionOptions
): MapInteractionController {
	return new MapInteractionManager(options);
}

// Implementation of the MapInteractionController interface, managing panning and zooming interactions for the simple map
class MapInteractionManager implements MapInteractionController {
	private readonly wrapper: HTMLElement;
	private readonly bgLayer: HTMLElement;
	private readonly tilesLayer: HTMLElement;
	private readonly toolbar: HTMLElement;
	private readonly parameters: SimpleMapParamaters;
	private readonly settings: SimpleMapSettings;
	private readonly onViewportChanged: MapInteractionOptions["onViewportChanged"];
	private readonly onInteractionStart?: () => void;

	private readonly state: PanZoomState;
	private isPanning = false;
	private panningEnabled = true;
	private lastX = 0;
	private lastY = 0;

	// Handle pointer down events to start panning, ensuring that interactions with the toolbar do not trigger panning
	private readonly onPointerDown = (e: PointerEvent) => {
		if (!this.panningEnabled) return;
		if (this.toolbar.contains(e.target as Node)) return;

		this.onInteractionStart?.();

		this.isPanning = true;
		this.lastX = e.clientX;
		this.lastY = e.clientY;

		this.wrapper.setPointerCapture(e.pointerId);
	};

	// Handle pointer move events to update the map's offset based on the movement, applying clamping and updating the transform
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

	// Handle pointer up events to stop panning
	private readonly onPointerUp = () => {
		this.isPanning = false;
	};

	// Handle wheel events to perform zooming, calculating the zoom factor based on the wheel delta and applying the zoom at the cursor position
	private readonly onWheel = (e: WheelEvent) => {
		e.preventDefault();

		const stepInput = this.toolbar.querySelector<HTMLInputElement>(".sm-zoom-step");
		const stepValue = Number(stepInput?.value);
		const base =
			1 +
			(isNaN(stepValue) ? this.settings.defaultZoomIncrement : stepValue) * 0.1;

		const factor = e.deltaY < 0 ? base : 1 / base;
		this.zoomAt(e.clientX, e.clientY, factor);
	};

	// Handle zoom in button clicks to zoom in at the viewport center, calculating the zoom factor based on the step input or default settings
	private readonly onZoomInClick = () => {
		const stepInput = this.toolbar.querySelector<HTMLInputElement>(".sm-zoom-step");
		const stepValue = Number(stepInput?.value);
		const step =
			Math.abs(stepValue) ||
			this.parameters.defaultZoomIncrement ||
			this.settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		this.zoomAtViewportCenter(factorBase);
	};

	// Handle zoom out button clicks to zoom out at the viewport center, calculating the zoom factor based on the step input or default settings
	private readonly onZoomOutClick = () => {
		const stepInput = this.toolbar.querySelector<HTMLInputElement>(".sm-zoom-step");
		const stepValue = Number(stepInput?.value);
		const step =
			Math.abs(stepValue) ||
			this.parameters.defaultZoomIncrement ||
			this.settings.defaultZoomIncrement;
		const factorBase = 1 + step * 0.1;
		this.zoomAtViewportCenter(1 / factorBase);
	};

	// Handle reset button clicks to reset the map view to the default position and zoom level
	private readonly onResetClick = () => {
		this.reset();
	};

	// Constructor to initialize the MapInteractionManager with the provided options, setting up references to DOM elements, map parameters, settings, and callback functions, and initializing the pan and zoom state
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
			minZoom: this.parameters.zoomRange[0] || 1,
			maxZoom: this.parameters.zoomRange[1] || 15,
		};
	}

	// Initialize the map interactions by adding event listeners for pointer and wheel events, as well as button clicks for zooming and resetting, and setting the initial map view
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

	// Enable or disable panning interactions, ensuring that if panning is disabled while currently panning, it will stop panning immediately
	setPanningEnabled(enabled: boolean): void {
		this.panningEnabled = enabled;
		if (!enabled) {
			this.isPanning = false;
		}
	}

	// Center the map on the supplied geographic location at the current zoom level. Mirrors the offset math used in reset() so pins land in the middle of the viewport.
	centerOnLocation(lat: number, lng: number): void {
		const rect = this.wrapper.getBoundingClientRect();
		const viewW = rect.width;
		const viewH = rect.height;

		const worldW = viewW * this.state.zoom;
		const worldH = viewH * this.state.zoom;

		const latMin = this.parameters.latitudeRange[0] ?? -90;
		const latMax = this.parameters.latitudeRange[1] ?? 90;
		const latRng = latMax - latMin;

		const lngMin = this.parameters.longitudeRange[0] ?? 0;
		const lngMax = this.parameters.longitudeRange[1] ?? 360;
		const lngRng = lngMax - lngMin;

		const offset = this.parameters.primeMeridianOffset ?? [0, 0];

		const targetLeft = -(lng + offset[1] - lngMin) / lngRng * worldW + (viewW / 2);
		const targetTop = -(-lat + offset[0] - latMin) / latRng * worldH + (viewH / 2);

		this.state.offsetX = targetLeft;
		this.state.offsetY = targetTop;

		this.clampOffsets();
		this.applyTransform();
	}

	// Clean up event listeners and reset the panning state when the map interactions are destroyed
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

	// Getters for the zoom in, zoom out, and reset buttons in the toolbar, returning the corresponding HTML button elements or null if they are not found
	private get zoomInBtn(): HTMLButtonElement | null {
		return this.toolbar.querySelector(".sm-zoom-in");
	}

	private get zoomOutBtn(): HTMLButtonElement | null {
		return this.toolbar.querySelector(".sm-zoom-out");
	}

	private get resetBtn(): HTMLButtonElement | null {
		return this.toolbar.querySelector(".sm-reset");
	}

	// Apply the current pan and zoom state to the map layers by calculating the appropriate CSS transforms and background styles based on the current offsets and zoom level, and invoking the viewport change callback with the updated parameters
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

	// Clamp the pan offsets to prevent panning beyond the edges of the map, taking into account the current zoom level and the repeat settings for the background
	private clampOffsets(): void {

		// Get the size of the wrapper element to calculate the visible area of the map
		const rect = this.wrapper.getBoundingClientRect();
		const viewW = rect.width;
		const viewH = rect.height;

		const worldW = viewW * this.state.zoom;
		const worldH = viewH * this.state.zoom;

		// Determine the repeat settings for the background, defaulting to "no-repeat" if not specified
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

		// Clamp offsets if they are finite, allowing for infinite values when repeat is enabled
		if (Number.isFinite(minX)) {
			this.state.offsetX = Math.max(minX, Math.min(maxX, this.state.offsetX));
		}

		if (Number.isFinite(minY)) {
			this.state.offsetY = Math.max(minY, Math.min(maxY, this.state.offsetY));
		}
	}

	// Reset the map view to the default position and zoom level based on the provided parameters, calculating the appropriate offsets to center the map on the default location
	private reset(): void {
		// set default zoom level
		this.state.zoom = this.parameters.defaultZoomLevel || 1;

		// get wrapper window size
		const rect = this.wrapper.getBoundingClientRect();

		// get height amd width of window
		const viewW = rect.width;
		const viewH = rect.height;

		// map scales based on view size
		const worldW = viewW * this.state.zoom;
		const worldH = viewH * this.state.zoom;

		// gat min, max, and range of latitude and longitude
		const latMin = this.parameters.latitudeRange[0] ?? -90;
		const latMax = this.parameters.latitudeRange[1] ?? 90;
		const latRng = latMax - latMin;

		const lngMin = this.parameters.longitudeRange[0] ?? 0;
		const lngMax = this.parameters.longitudeRange[1] ?? 360;
		const lngRng = lngMax - lngMin;

		const defaultLatitude = -this.parameters.defaultLocation[0];
		const defaultLongitude = this.parameters.defaultLocation[1];

		// find default position for map element
		const defaultLeft = -(defaultLongitude + this.parameters.primeMeridianOffset[1] - lngMin) / lngRng * worldW + (viewW / 2);
		const defaultTop = -(defaultLatitude + this.parameters.primeMeridianOffset[0] - latMin) / latRng * worldH + (viewH / 2);

		this.state.offsetX = defaultLeft;
		this.state.offsetY = defaultTop;

		this.clampOffsets();
		this.applyTransform();
	}

	// Zoom the map at a specific client (screen) coordinate by a given zoom factor, calculating the new zoom level and adjusting the offsets to keep the zoom centered on the specified point
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

	// Zoom the map at the center of the viewport by a given zoom factor, calculating the center point of the wrapper element and invoking the zoomAt method with those coordinates
	private zoomAtViewportCenter(zoomFactor: number): void {
		const rect = this.wrapper.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		this.zoomAt(cx, cy, zoomFactor);
	}
}
