import {
	App,
	Component,
	FrontMatterCache,
	MarkdownPostProcessorContext,
	normalizePath,
	TFile,
} from "obsidian";
import { FantasyMapParams } from "./paramaters";
import {
	showCustomPreview,
	hideCustomPreview,
	destroyCustomPreview,
} from "./previewInteractions";

import defaultPinIcon from "./assets/Pin.svg";

interface Location {
	lat: number;
	lng: number;
}

interface Position {
	left: number;
	top: number;
}

interface FormattedPosition {
	left: string;
	top: string;
}

export interface Pin {
	note: TFile;
	element: HTMLElement;
	location: Location;
}

export interface PinInteractionController {
	init(): Promise<void>;
	updatePinPositions(
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	): void;
	clearHoverDelay(): void;
	destroy(): void;
}

interface PinInteractionOptions {
	app: App;
	component: Component;
	wrapper: HTMLElement;
	parameters: FantasyMapParams;
	ctx: MarkdownPostProcessorContext;
	setMapPanningEnabled: (enabled: boolean) => void;
}

export function createPinInteractionController(
	options: PinInteractionOptions
): PinInteractionController {
	return new PinInteractionManager(options);
}

class PinInteractionManager implements PinInteractionController {
	private readonly app: App;
	private readonly component: Component;
	private readonly wrapper: HTMLElement;
	private readonly parameters: FantasyMapParams;
	private readonly ctx: MarkdownPostProcessorContext;
	private readonly setMapPanningEnabled: (enabled: boolean) => void;

	private pins: Pin[] = [];
	private selectedPin: Pin | null = null;
	private pinDragging = false;
	private pointerStartPos: Position | null = null;
	private hoverTimeout: number | null = null;
	private suppressPreviewUntil = 0;

	private latBounds = { min: 0, max: 0 };
	private lngBounds = { min: 0, max: 0 };

	private currentMap = {
		width: 0,
		height: 0,
		xOffset: 0,
		yOffset: 0,
	};

	private readonly onWrapperPointerMove = (e: PointerEvent) => {
		if (!this.selectedPin || !this.pointerStartPos) return;

		const currentPos = this.mouseToPx(e, this.wrapper.getBoundingClientRect());

		if (!this.pinDragging) {
			const dx = currentPos.left - this.pointerStartPos.left;
			const dy = currentPos.top - this.pointerStartPos.top;
			const distanceSquared = dx * dx + dy * dy;

			if (distanceSquared > 25) {
				this.pinDragging = true;
				this.suppressPreview(150);
			}
		}

		if (!this.pinDragging) return;

		const formattedPx = this.formatPx(currentPos);
		this.selectedPin.element.setCssStyles({
			left: formattedPx.left,
			top: formattedPx.top,
		});
	};

	private readonly onWrapperPointerUp = async (e: PointerEvent) => {
		if (!this.selectedPin) return;

		const selectedPin = this.selectedPin;

		if (this.pinDragging) {
			const px = this.mouseToPx(e, this.wrapper.getBoundingClientRect());

			px.left = this.wrapValue(
				px.left - this.currentMap.xOffset,
				this.currentMap.width
			);
			px.top = this.wrapValue(
				px.top - this.currentMap.yOffset,
				this.currentMap.height
			);

			selectedPin.location = this.pxToLocation(px);

			await this.app.fileManager.processFrontMatter(
				selectedPin.note, (frontmatter: FrontMatterCache) => {
					frontmatter["fm-location"] = this.formatLocation(selectedPin.location) as string;
				}
			);
		} else {
			this.suppressPreview(200);
			destroyCustomPreview();
			await this.app.workspace.openLinkText(selectedPin.note.path, "", false);  
		}

		this.setMapPanningEnabled(true);
		this.selectedPin = null;
		this.pinDragging = false;
		this.pointerStartPos = null;
	};

	private readonly onWrapperPointerLeave = () => {
		if (!this.pinDragging) return;

		this.pinDragging = false;
		this.selectedPin = null;
		this.pointerStartPos = null;
		this.setMapPanningEnabled(true);

		this.updatePinPositions(
			this.currentMap.xOffset,
			this.currentMap.yOffset,
			this.currentMap.width,
			this.currentMap.height
		);
	};

	constructor(options: PinInteractionOptions) {
		this.app = options.app;
		this.component = options.component;
		this.wrapper = options.wrapper;
		this.parameters = options.parameters;
		this.ctx = options.ctx;
		this.setMapPanningEnabled = options.setMapPanningEnabled;
	}

	async init(): Promise<void> {
		if (
			this.parameters.latitudeRange == null ||
			this.parameters.longitudeRange == null
		) {
			return;
		}

		this.currentMap.width = this.wrapper.clientWidth;
		this.currentMap.height = this.wrapper.clientHeight;

		this.latBounds = {
			min: this.parameters.latitudeRange[0],
			max: this.parameters.latitudeRange[1],
		};

		this.lngBounds = {
			min: this.parameters.longitudeRange[0],
			max: this.parameters.longitudeRange[1],
		};

		const notes = this.app.vault.getMarkdownFiles();
		for (const note of notes) {
			await this.createPin(note);
		}

		this.wrapper.addEventListener("pointermove", this.onWrapperPointerMove);
		this.wrapper.addEventListener("pointerup", this.onWrapperPointerUp);
		this.wrapper.addEventListener("pointerleave", this.onWrapperPointerLeave);
		
		return;
	}

	updatePinPositions(
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	): void {
		this.currentMap.width = tileWidth;
		this.currentMap.height = tileHeight;
		this.currentMap.xOffset = offsetX;
		this.currentMap.yOffset = offsetY;

		for (const pin of this.pins) {
			if (pin === this.selectedPin) continue;

			const px = this.locationToPx(pin.location);

			pin.element.setCssStyles({
				left: `${this.wrapValue(px.left + offsetX, tileWidth)}px`,
				top: `${this.wrapValue(px.top + offsetY, tileHeight)}px`,
			});
		}
	}

	clearHoverDelay(): void {
		if (this.hoverTimeout !== null) {
			window.clearTimeout(this.hoverTimeout);
			this.hoverTimeout = null;
		}
	}

	destroy(): void {
		this.clearHoverDelay();
		this.wrapper.removeEventListener("pointermove", this.onWrapperPointerMove);
		this.wrapper.removeEventListener("pointerup", this.onWrapperPointerUp);
		this.wrapper.removeEventListener("pointerleave", this.onWrapperPointerLeave);

		for (const pin of this.pins) {
			pin.element.remove();
		}

		this.pins = [];
		this.selectedPin = null;
		this.pointerStartPos = null;
		this.pinDragging = false;
		destroyCustomPreview();
	}

	private async createPin(note: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(note);
		const frontMatter = cache?.frontmatter;
		if (!frontMatter) return;

		const frontMatterLocation = frontMatter["fm-location"] as string;
		if (frontMatterLocation === undefined) return;

		const mapIDs = this.parameters.mapIDs ?? [];
		if (mapIDs.length > 0 && mapIDs[0] !== "") {
			const mapId: unknown = frontMatter["fm-id"];
			if (mapId == null || !mapIDs.includes(String(mapId))) return;
		}

		const location = this.parseFormattedLocation(String(frontMatterLocation));
		if (!location) return;

		if (
			location.lat < this.latBounds.min ||
			location.lat > this.latBounds.max ||
			location.lng < this.lngBounds.min ||
			location.lng > this.lngBounds.max
		) {
			return;
		}

		const pinElement = this.wrapper.createEl("div", { cls: "map-pin" });

		const formattedPx = this.formatPx(this.locationToPx(location));
		pinElement.setCssStyles({
			left: formattedPx.left,
			top: formattedPx.top,
		});

		const pinIconEl = pinElement.createEl("div", { cls: "map-pin-icon" });

		const pinIconValue: unknown = frontMatter["fm-pin-icon"];
		const pinFile = this.resolvePinIconFile(
			this.app,
			pinIconValue,
			this.ctx.sourcePath
		);

		if (pinFile) {
			if (pinFile.extension.toLowerCase() === "svg") {
				pinIconEl.innerHTML = this.addSvgViewBoxPadding(
					await this.app.vault.cachedRead(pinFile),
					2
				);
			} else {
				const url = this.app.vault.getResourcePath(pinFile);
				pinIconEl.createEl("img", {
					attr: {
						src: url,
						alt: "",
					},
				});
			}
		} else {
			pinIconEl.innerHTML = this.addSvgViewBoxPadding(defaultPinIcon, 2);
		}

		const match = this.parameters.pinSize.trim().match(
			/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/
		);

		if (match) {
			pinIconEl.setCssStyles({
				width: `${Number(match[1]) * 0.01 * this.currentMap.width}px`,
			});
		} else {
			pinIconEl.setCssStyles({
				width: this.parameters.pinSize,
			});
		}

		const newPin: Pin = {
			note,
			element: pinElement,
			location,
		};

		this.initPinActions(newPin);
		this.pins.push(newPin);
	}

	private initPinActions(pin: Pin): void {
		pin.element.addEventListener("pointerenter", (e) => {
			if (this.selectedPin || this.shouldSuppressPreview()) return;

			this.startHoverDelay(100, () => {
				void showCustomPreview(pin, this.app, this.component, e);
			});
		});

		pin.element.addEventListener("pointerleave", () => {
			this.startHoverDelay(750, () => {
				hideCustomPreview();
			});
		});

		pin.element.addEventListener("pointerdown", (e) => {
			if (this.selectedPin) return;

			e.stopPropagation();
			this.clearHoverDelay();
			hideCustomPreview();

			this.selectedPin = pin;
			this.pinDragging = false;
			this.pointerStartPos = this.mouseToPx(
				e,
				this.wrapper.getBoundingClientRect()
			);

			this.setMapPanningEnabled(false);
		});
	}

	private startHoverDelay(time: number, callback: () => void): void {
		this.clearHoverDelay();
		this.hoverTimeout = window.setTimeout(() => {
			callback();
		}, time);
	}

	private suppressPreview(ms: number): void {
		this.suppressPreviewUntil = Date.now() + ms;
	}

	private shouldSuppressPreview(): boolean {
		return Date.now() < this.suppressPreviewUntil;
	}

	private resolvePinIconFile(
		app: App,
		value: unknown,
		sourcePath: string
	): TFile | null {
		if (typeof value !== "string") return null;

		const raw = value.trim();
		if (!raw) return null;

		const normalized = raw.replace(/^\[\[|\]\]$/g, "").trim();
		if (!normalized) return null;

		const linked = app.metadataCache.getFirstLinkpathDest(normalized, sourcePath);
		if (linked instanceof TFile) return linked ?? null;

		const byPath = app.vault.getAbstractFileByPath(normalizePath(normalized));
		if (byPath instanceof TFile) return byPath ?? null;

		const files = app.vault.getFiles();
		const lower = normalized.toLowerCase();

		const supportedExts = new Set(["svg", "png", "jpg", "jpeg", "webp", "gif"]);

		const exactName = files.find((f) => f.name.toLowerCase() === lower);
		if (exactName && supportedExts.has(exactName.extension.toLowerCase())) {
			return exactName ?? null;
		}

		const basenameMatches = files.filter(
			(f) =>
				f.basename.toLowerCase() === lower &&
				supportedExts.has(f.extension.toLowerCase())
		);

		if (basenameMatches.length === 1) return basenameMatches[0] ?? null;

		const svgMatch = basenameMatches.find(
			(f) => f.extension.toLowerCase() === "svg"
		);
		if (svgMatch) return svgMatch ?? null;

		return basenameMatches[0] ?? null;
	}

	private addSvgViewBoxPadding(svg: string, pad: number): string {
		return svg.replace(/viewBox="([^"]+)"/, (_, vb: string) => {
			const [x, y, w, h] = vb.trim().split(/\s+/).map(Number);
			if ([x, y, w, h].some(Number.isNaN) || [x, y, w, h].some((v) => v === undefined)) return `viewBox="${vb}"`;
			
			return `viewBox="${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}"`;
		});
	}

	private formatLocation(location: Location): string {
		return `(${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
	}

	private parseFormattedLocation(formattedLocation: string): Location | null {
		const match = formattedLocation.match(
			/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/
		);
		if (!match) return null;

		const location = {
			lat: Number(match[1]),
			lng: Number(match[2]),
		};

		if (Number.isNaN(location.lat) || Number.isNaN(location.lng)) return null;
		return location;
	}

	private formatPx(px: Position): FormattedPosition {
		return {
			left: `${px.left}px`,
			top: `${px.top}px`,
		};
	}

	private locationToPx(locVal: Location): Position {
		const latBoundsRange = this.latBounds.max - this.latBounds.min;
		const lngBoundsRange = this.lngBounds.max - this.lngBounds.min;
		const offset = this.parameters.primeMeridianOffset ?? [0, 0];

		return {
			left:
				(this.wrapValue(
						locVal.lng - this.lngBounds.min + offset[1],
						lngBoundsRange
					) /
					lngBoundsRange) *
				this.currentMap.width,
			top:
				(this.wrapValue(
						-locVal.lat - this.latBounds.min + offset[0],
						latBoundsRange
					) /
					latBoundsRange) *
				this.currentMap.height,
		};
	}

	private pxToLocation(px: Position): Location {
		const latBoundsRange = this.latBounds.max - this.latBounds.min;
		const lngBoundsRange = this.lngBounds.max - this.lngBounds.min;
		const offset = this.parameters.primeMeridianOffset ?? [0, 0];

		return {
			lat:
				-(
					this.wrapValue(
						(px.top / this.currentMap.height) * latBoundsRange - offset[0],
						latBoundsRange
					) + this.latBounds.min
				),
			lng:
				this.wrapValue(
					(px.left / this.currentMap.width) * lngBoundsRange - offset[1],
					lngBoundsRange
				) + this.lngBounds.min,
		};
	}

	private mouseToPx(event: MouseEvent | PointerEvent, rect: DOMRect): Position {
		return {
			left: event.clientX - rect.left,
			top: event.clientY - rect.top,
		};
	}

	private wrapValue(n: number, m: number): number {
		return ((n % m) + m) % m;
	}
}
