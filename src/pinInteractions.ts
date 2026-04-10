import {App, CachedMetadata, MarkdownPostProcessorContext, MarkdownRenderer, Plugin, TFile, Component } from "obsidian";
import { FantasyMapSettings } from "./settings";
import { FantasyMapParams } from "./paramaters";
import { updateMapInnerSize } from "./mapRenderer";
import { cancelMapPanning } from "./mapInteractions";
import { showCustomPreview, hideCustomPreview, destroyCustomPreview } from "./previewInteractions"

import pinIcon from "./assets/mapPinIcon_customizable.svg";

export interface Pin {
	note: TFile;
	element: HTMLElement;
	location: Location;
}

const Pins: Pin[] = [];
var selectedPin: Pin | null = null;
var enablePinDrag = false;
var disablePreviews = false;
var latBounds: { min: number, max: number } = { min: 0, max: 0 };
var lngBounds: { min: number, max: number } = { min: 0, max: 0 };

var currentMap: { width: number, height: number, xOffset: number, yOffset: number } = { width: 0, height: 0, xOffset: 0, yOffset: 0 };

export async function initPinInteractions(
	app: App,
	component: Component,
	wrapper: HTMLElement,
	paramaters: FantasyMapParams,
	settings: FantasyMapSettings,
	element: HTMLElement,
	ctx: MarkdownPostProcessorContext,
) {
	
	disablePreviews = false;
	
	// collect all notes that contain fantasy map front matter and store them in pins
	const notes = app.vault.getMarkdownFiles();
	
	currentMap.width = wrapper.clientWidth;
	currentMap.height = wrapper.clientHeight;
	
	// define the map latitude and longitude bounds
	latBounds = { min: paramaters.latitudeRange[0], max: paramaters.latitudeRange[1] };
	lngBounds = { min: paramaters.longitudeRange[0], max: paramaters.longitudeRange[1] };
	
	// iterate through all note files to find all location relavent notes to attach to the map
	for (const note of notes) {
		createPin(note);
	}

	function createPin(note: TFile){
		//#region parse and filter note front matter

		// get the note front matter; if no front matter detected, skip the note
		const cache = app.metadataCache.getFileCache(note);
		const frontMatter = cache?.frontmatter;
		if (!frontMatter) return;

		// if mapIDs parameter is set, only include notes with a matching fantasy-map-id in their front matter
		if (paramaters.mapIDs.length > 0 && paramaters.mapIDs[0] !== "") {
			const mapId = frontMatter["fantasy-map-id"];
			if (mapId !== undefined && !paramaters.mapIDs.includes(mapId)) return;
		}

		// get location from front matter and parse it; if no location or invalid format, skip the note
		const frontMatterLc = frontMatter["fantasy-map-location"];
		if (frontMatterLc === undefined) return;

		const location = parseFormattedLocation(frontMatterLc);
		if (!location) return;
		
		// skip locations that are outside the map bounds 
		if (location.lat < latBounds.min || location.lat > latBounds.max || location.lng < lngBounds.min || location.lng > lngBounds.max) return``;

		//#endregion

		//#region create pin icon

		const element = wrapper.createEl("div", { cls: "map-pin" });
		//attachPinHoverBehaviour(this, pin, app); !!

		// translate the location's latitude and longitude to a px of the map bounds for CSS positioning and apply them to the pin element
		const formattedPx = formatPx(locationToPx(location));
		element.style.left = formattedPx.left;
		element.style.top = formattedPx.top;

		// get the pin icon and add it to the pin element; set the width of the icon to 12px
		const pinIconEl = element.createEl("div", { cls: "map-pin-icon" });
		pinIconEl.innerHTML = pinIcon;
		pinIconEl.style.width = `12px`;
		//#endregion
		
		const newPin = { note, element, location }

		initPinActions(newPin, app, component);
		
		Pins.push(newPin);
	}
	
	wrapper.addEventListener("pointermove", (e) => {
		if (!selectedPin) return;
		
		if (!enablePinDrag) {
			selectedPin = null;
			return;
		}
		
		const formattedPx = formatPx(mouseToPx(e, wrapper.getBoundingClientRect()));
		selectedPin.element.style.left = formattedPx.left;
		selectedPin.element.style.top = formattedPx.top;
	});
	
	wrapper.addEventListener("pointerup", async (e) => {
		if (!selectedPin) return;
		
		if (selectedPin.note) {
			if (enablePinDrag) {
				const px = mouseToPx(e, wrapper.getBoundingClientRect());

				px.left = wrapValue(px.left - currentMap.xOffset, currentMap.width);
				px.top = wrapValue(px.top - currentMap.yOffset, currentMap.height);

				selectedPin.location = pxToLocation(px);
				await app.fileManager.processFrontMatter(selectedPin.note, (frontmatter) => {
					frontmatter["fantasy-map-location"] = formatLocation(selectedPin.location);
				});
			}
			else {
				disablePreviews = true;
				destroyCustomPreview();
				app.workspace.openLinkText(selectedPin.note.path, "", false);
			}
		}

		enablePinDrag = false;
		selectedPin = null;
	})
	
	wrapper.addEventListener("pointerleave", (e) => {
		if (enablePinDrag){
			enablePinDrag = false;
			selectedPin = null;
			updatePinPositions(currentMap.xOffset, currentMap.yOffset, currentMap.width, currentMap.height);
		}
	})
}

//#region Helper functions for translating between location and px coordinates, and handling mouse position and hover timeouts

interface Location { lat: number; lng: number }
interface Position { left: number; top: number }
interface FormattedPosition { left: string; top: string }

//#region functions to format and parse location and px coordinates for use between css styles and front matter

function formatLocation(location: Location): string {
	return `(${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
}

function parseFormattedLocation(formattedLocation: string): Location | null {
	const locationRegex = formattedLocation.match(/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/);
	if (!locationRegex) return null;

	const location = { lat: Number(locationRegex[1]), lng: Number(locationRegex[2])}
	if (!location || Number.isNaN(location.lat) || Number.isNaN(location.lng)) return null;

	return location;
}

function formatPx(px: Position): FormattedPosition{
	return {
		left: `${px.left}px`,
		top: `${px.top}px`,
	}
}

function parseFormattedPx(formattedPx: FormattedPosition): Position | null {
	const leftMatch = formattedPx.left.match(/(-?\d+(?:\.\d+)?)\s*px/);
	const topMatch = formattedPx.top.match(/(-?\d+(?:\.\d+)?)\s*px/);
	if (!leftMatch || !topMatch) return null;

	return {
		left: Number(leftMatch[1]),
		top: Number(topMatch[1])
	}
}

//#endregion

//#region functions to translate between location and px coordinates, and handle mouse position

function locationToPx(locVal: Location) : Position {
	return {
		left: (locVal.lng - lngBounds.min) / (lngBounds.max - lngBounds.min) * currentMap.width,
		top: (-locVal.lat - latBounds.min) / (latBounds.max - latBounds.min) * currentMap.height
	}
}

function pxToLocation(px: Position): Location {
	return {
		lat: -(px.top / currentMap.height * (latBounds.max - latBounds.min) + latBounds.min),
		lng: px.left / currentMap.width * (lngBounds.max - lngBounds.min) + lngBounds.min
	}
}

function mouseToLocation(event: MouseEvent, rect: DOMRect): Location {
	const px = mouseToPx(event, rect);
	return pxToLocation(px);
}

function mouseToPx(event: MouseEvent, rect: DOMRect): Position {
	return {
		left: (event.clientX - rect.left),
		top: (event.clientY - rect.top)
	}
}

//#endregion

function wrapValue(n: number, m: number) {
	return ((n % m) + m) % m;
}

export function updatePinPositions(offsetX: number, offsetY: number, tileWidth: number, tileHeight: number) {
	if (Pins == undefined || Pins == null) return;

	currentMap.width = tileWidth;
	currentMap.height = tileHeight;
	currentMap.xOffset = offsetX;
	currentMap.yOffset = offsetY;
	
	for (const pin of Pins) {
		if (pin == selectedPin) continue;
		
		const px = locationToPx(pin.location);
		
		const formattedPx = {
			left: `${wrapValue(px.left + offsetX, tileWidth)}px`,
			top: `${wrapValue(px.top + offsetY, tileHeight)}px`
		}
		
		pin.element.style.left = formattedPx.left;
		pin.element.style.top  = formattedPx.top;
	}
}

var timeOut: number | null = null;

export function startTimeOut(time: number, callback: () => void){
	clearTimeOut();
	timeOut = window.setTimeout(() => { callback(); }, time);
}

export function clearTimeOut(){
	if (timeOut !== null) {
		window.clearTimeout(timeOut);
		timeOut = null;
	}
}

function initPinActions(pin: Pin, app: App, component: Component) {
	pin.element.addEventListener("pointerenter", (e) => {
		if (selectedPin || disablePreviews) return;
		startTimeOut(100, () => {showCustomPreview(pin, app, component, e)} );
	});

	// Close custom preview on mouse leave
	pin.element.addEventListener("pointerleave", (e) => {
		startTimeOut(750, () => {
			hideCustomPreview();
		});
	});

	pin.element.addEventListener("pointerdown", (e) => {
		if (selectedPin) return; // already moving a pin, ignore new pointerdown events until current pin is released
		selectedPin = pin;
		
		hideCustomPreview();
		startTimeOut(100, () => {
			cancelMapPanning();
			enablePinDrag = true;
		});
	});
}

//#endregion


