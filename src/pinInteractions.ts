import {
	App,
	Component,
	MarkdownPostProcessorContext,
	normalizePath,
	TFile,
} from "obsidian";
import { FantasyMapParams } from "./paramaters";
import { cancelMapPanning } from "./mapInteractions";
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

const Pins: Pin[] = [];
let selectedPin: Pin | null = null;
let enablePinDrag = false;
let disablePreviews = false;

let latBounds: { min: number; max: number } = { min: 0, max: 0 };
let lngBounds: { min: number; max: number } = { min: 0, max: 0 };

let currentMap: { width: number; height: number; xOffset: number; yOffset: number } = {
	width: 0,
	height: 0,
	xOffset: 0,
	yOffset: 0,
};

let timeOut: number | null = null;

export async function initPinInteractions(
	app: App,
	component: Component,
	wrapper: HTMLElement,
	paramaters: FantasyMapParams,
	element: HTMLElement,
	ctx: MarkdownPostProcessorContext
) {
	disablePreviews = false;
	Pins.length = 0;

	const notes = app.vault.getMarkdownFiles();

	currentMap.width = wrapper.clientWidth;
	currentMap.height = wrapper.clientHeight;

	if (paramaters.latitudeRange == null || paramaters.longitudeRange == null) return;

	latBounds = {
		min: paramaters.latitudeRange[0],
		max: paramaters.latitudeRange[1],
	};
	lngBounds = {
		min: paramaters.longitudeRange[0],
		max: paramaters.longitudeRange[1],
	};

	for (const note of notes) {
		await createPin(note);
	}

	wrapper.addEventListener("pointermove", (e) => {
		if (!selectedPin) return;

		if (!enablePinDrag) {
			selectedPin = null;
			return;
		}

		const formattedPx = formatPx(mouseToPx(e, wrapper.getBoundingClientRect()));
		selectedPin.element.setCssStyles({
			left: formattedPx.left,
			top: formattedPx.top,
		});
	});

	wrapper.addEventListener("pointerup", async (e) => {
		if (!selectedPin) return;

		if (enablePinDrag) {
			const px = mouseToPx(e, wrapper.getBoundingClientRect());

			px.left = wrapValue(px.left - currentMap.xOffset, currentMap.width);
			px.top = wrapValue(px.top - currentMap.yOffset, currentMap.height);

			selectedPin.location = pxToLocation(px);

			const pinToUpdate = selectedPin;
			await app.fileManager.processFrontMatter(pinToUpdate.note, (frontmatter) => {
				frontmatter["fm-location"] = formatLocation(pinToUpdate.location);
			});
		} else {
			disablePreviews = true;
			destroyCustomPreview();
			app.workspace.openLinkText(selectedPin.note.path, "", false);
		}

		enablePinDrag = false;
		selectedPin = null;

		return;
	});

	wrapper.addEventListener("pointerleave", () => {
		if (enablePinDrag) {
			enablePinDrag = false;
			selectedPin = null;
			updatePinPositions(
				currentMap.xOffset,
				currentMap.yOffset,
				currentMap.width,
				currentMap.height
			);
		}
	});

	async function createPin(note: TFile) {
		const cache = app.metadataCache.getFileCache(note);
		const frontMatter = cache?.frontmatter;
		if (!frontMatter) return;

		const mapIDs = paramaters.mapIDs ?? [];
		if (mapIDs.length > 0 && mapIDs[0] !== "") {
			const mapId: unknown = frontMatter["fm-id"];
			if (mapId !== undefined && !mapIDs.includes(String(mapId))) return;
		}

		const frontMatterLocation: unknown = frontMatter["fm-location"];
		if (frontMatterLocation === undefined) return;

		const location = parseFormattedLocation(String(frontMatterLocation));
		if (!location) return;

		if (
			location.lat < latBounds.min ||
			location.lat > latBounds.max ||
			location.lng < lngBounds.min ||
			location.lng > lngBounds.max
		) {
			return;
		}

		const pinElement = wrapper.createEl("div", { cls: "map-pin" });

		const formattedPx = formatPx(locationToPx(location));
		pinElement.setCssStyles({
			left: formattedPx.left,
			top: formattedPx.top,
		});

		const pinIconEl = pinElement.createEl("div", { cls: "map-pin-icon" });

		const pinIconValue: unknown = frontMatter["fm-pin-icon"];
		const pinFile = resolvePinIconFile(app, pinIconValue, ctx.sourcePath);

		if (pinFile) {
			if (pinFile.extension.toLowerCase() === "svg") {
				pinIconEl.innerHTML = addSvgViewBoxPadding(
					await app.vault.cachedRead(pinFile),
					2
				);
			} else {
				const url = app.vault.getResourcePath(pinFile);
				pinIconEl.createEl("img", {
					attr: {
						src: url,
						alt: "",
					},
				});
			}
		} else {
			pinIconEl.innerHTML = addSvgViewBoxPadding(defaultPinIcon, 2);
		}

		const match = paramaters.pinSize.trim().match(
			/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/
		);

		if (match) {
			pinIconEl.setCssStyles({
				width: `${Number(match[1]) * 0.01 * currentMap.width}px`,
			});
		} else {
			pinIconEl.setCssStyles({
				width: paramaters.pinSize,
			});
		}

		const newPin: Pin = {
			note,
			element: pinElement,
			location,
		};

		initPinActions(newPin, app, component);
		Pins.push(newPin);
	}
}

function resolvePinIconFile(
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
	if (exactName && supportedExts.has(exactName.extension.toLowerCase())) return exactName ?? null;

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

function addSvgViewBoxPadding(svg: string, pad: number): string {
	return svg.replace(/viewBox="([^"]+)"/, (_, vb) => {
		const [x, y, w, h] = vb.trim().split(/\s+/).map(Number);
		if ([x, y, w, h].some(Number.isNaN)) return `viewBox="${vb}"`;
		return `viewBox="${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}"`;
	});
}

function formatLocation(location: Location): string {
	return `(${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
}

function parseFormattedLocation(formattedLocation: string): Location | null {
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

function formatPx(px: Position): FormattedPosition {
	return {
		left: `${px.left}px`,
		top: `${px.top}px`,
	};
}

/*function parseFormattedPx(formattedPx: FormattedPosition): Position | null {
	const leftMatch = formattedPx.left.match(/(-?\d+(?:\.\d+)?)\s*px/);
	const topMatch = formattedPx.top.match(/(-?\d+(?:\.\d+)?)\s*px/);
	if (!leftMatch || !topMatch) return null;

	return {
		left: Number(leftMatch[1]),
		top: Number(topMatch[1]),
	};
}*/

function locationToPx(locVal: Location): Position {
	return {
		left:
			((locVal.lng - lngBounds.min) / (lngBounds.max - lngBounds.min)) *
			currentMap.width,
		top:
			((-locVal.lat - latBounds.min) / (latBounds.max - latBounds.min)) *
			currentMap.height,
	};
}

function pxToLocation(px: Position): Location {
	return {
		lat: -(px.top / currentMap.height * (latBounds.max - latBounds.min) + latBounds.min),
		lng: px.left / currentMap.width * (lngBounds.max - lngBounds.min) + lngBounds.min,
	};
}

function mouseToPx(event: MouseEvent, rect: DOMRect): Position {
	return {
		left: event.clientX - rect.left,
		top: event.clientY - rect.top,
	};
}

function wrapValue(n: number, m: number) {
	return ((n % m) + m) % m;
}

export function updatePinPositions(
	offsetX: number,
	offsetY: number,
	tileWidth: number,
	tileHeight: number
) {
	currentMap.width = tileWidth;
	currentMap.height = tileHeight;
	currentMap.xOffset = offsetX;
	currentMap.yOffset = offsetY;

	for (const pin of Pins) {
		if (pin === selectedPin) continue;

		const px = locationToPx(pin.location);

		pin.element.setCssStyles({
			left: `${wrapValue(px.left + offsetX, tileWidth)}px`,
			top: `${wrapValue(px.top + offsetY, tileHeight)}px`,
		});
	}
}

export function startTimeOut(time: number, callback: () => void) {
	clearTimeOut();
	timeOut = window.setTimeout(() => {
		callback();
	}, time);
}

export function clearTimeOut() {
	if (timeOut !== null) {
		window.clearTimeout(timeOut);
		timeOut = null;
	}
}

function initPinActions(pin: Pin, app: App, component: Component) {
	pin.element.addEventListener("pointerenter", (e) => {
		if (selectedPin || disablePreviews) return;
		startTimeOut(100, () => {
			showCustomPreview(pin, app, component, e);
		});
	});

	pin.element.addEventListener("pointerleave", () => {
		startTimeOut(750, () => {
			hideCustomPreview();
		});
	});

	pin.element.addEventListener("pointerdown", () => {
		if (selectedPin) return;

		selectedPin = pin;
		hideCustomPreview();

		startTimeOut(100, () => {
			cancelMapPanning();
			enablePinDrag = true;
		});
	});
}
