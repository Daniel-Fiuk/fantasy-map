import {
	App,
	Component,
	FrontMatterCache,
	MarkdownPostProcessorContext,
	normalizePath,
	TFile,
} from "obsidian";
import { SimpleMapParams } from "./paramaters";
import {
	showCustomPreview,
	hideCustomPreview,
	destroyCustomPreview,
	setPreviewTimeoutClearer,
	setPreviewTimeoutScheduler,
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

// Describes which property in a note matched the active search query, used so the preview can show the user *why* a pin is currently visible.
export interface PinMatchInfo {
	property: string;
	value: string;
}

export interface Pin {
	note: TFile;
	element: HTMLElement;
	location: Location;
	// Aggregated, lower-cased text snippets indexed by property name. Built once at pin creation so search is cheap.
	searchIndex: { property: string; rawValue: string; haystack: string }[];
	matchInfo: PinMatchInfo | null;
}

// Search-related types exposed for the toolbar wiring.
export interface PinSearchSuggestion {
	pin: Pin;
	label: string;
	property: string;
	value: string;
}

// Interface defining the contract for the PinInteractionController, which manages pin interactions on the simple map.
export interface PinInteractionController {
	init(): Promise<void>;
	updatePinPositions(
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	): void;
	clearHoverDelay(): void;
	applySearch(query: string): void;
	getSuggestions(query: string, limit?: number): PinSearchSuggestion[];
	getPins(): Pin[];
	destroy(): void;
}

// Factory function to create an instance of the PinInteractionController with the provided options.
interface PinInteractionOptions {
	app: App;
	component: Component;
	wrapper: HTMLElement;
	parameters: SimpleMapParams;
	ctx: MarkdownPostProcessorContext;
	setMapPanningEnabled: (enabled: boolean) => void;
}

// Creates and initializes a new PinInteractionController instance with the given options.
export function createPinInteractionController(
	options: PinInteractionOptions
): PinInteractionController {
	return new PinInteractionManager(options);
}

class PinInteractionManager implements PinInteractionController {
	private readonly app: App;
	private readonly component: Component;
	private readonly wrapper: HTMLElement;
	private readonly parameters: SimpleMapParams;
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

	// Event handler for pointer movement on the map wrapper, managing pin dragging and preview suppression.
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

	// Event handler for pointer release on the map wrapper, finalizing pin dragging or opening the associated note.
	private readonly onWrapperPointerUp = (e: PointerEvent): void => {
		void this.handleWrapperPointerUp(e);
	};

	// Handles the logic for pointer release on the map wrapper, including updating pin location or opening the note.
	private async handleWrapperPointerUp(e: PointerEvent): Promise<void> {

		// If no pin is currently selected, there's nothing to do on pointer release.
		if (!this.selectedPin) return;
		const selectedPin = this.selectedPin;

		// If the pin was being dragged, calculate the new location and update the note's front matter. Otherwise, open the note in Obsidian.
		if (this.pinDragging) {
			const px = this.mouseToPx(e, this.wrapper.getBoundingClientRect());

			// Adjust the pixel position based on the current map offsets and dimensions, ensuring it wraps correctly within the map boundaries.
			px.left = this.wrapValue(
				px.left - this.currentMap.xOffset,
				this.currentMap.width
			);
			px.top = this.wrapValue(
				px.top - this.currentMap.yOffset,
				this.currentMap.height
			);

			selectedPin.location = this.pxToLocation(px);

			// Update the front matter of the associated note with the new location, using Obsidian's file manager API to process the front matter.
			await this.app.fileManager.processFrontMatter(
				selectedPin.note,
				(frontmatter: FrontMatterCache) => {
					frontmatter["sm-location"] = this.formatLocation(selectedPin.location);
				}
			);
		} else {

			// If the pin was not dragged, treat this as a click and open the associated note in Obsidian, suppressing the preview to avoid conflicts.
			this.suppressPreview(200);
			destroyCustomPreview();
			await this.app.workspace.openLinkText(selectedPin.note.path, "", false);
		}

		// Reset the state after handling the pointer release, enabling map panning and clearing the selected pin and dragging state.
		this.setMapPanningEnabled(true);
		this.selectedPin = null;
		this.pinDragging = false;
		this.pointerStartPos = null;
	}

	// Event handler for pointer leaving the map wrapper, canceling any ongoing pin dragging and resetting state.
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

	// Constructor for the PinInteractionManager, initializing properties and setting up preview timeout handlers.
	constructor(options: PinInteractionOptions) {
		this.app = options.app;
		this.component = options.component;
		this.wrapper = options.wrapper;
		this.parameters = options.parameters;
		this.ctx = options.ctx;
		this.setMapPanningEnabled = options.setMapPanningEnabled;

		// Set up the function to clear any existing hover delay when showing a new preview, ensuring that only one preview is shown at a time.
		setPreviewTimeoutClearer(() => {
			this.clearHoverDelay();
		});

		// Set up the scheduler for hiding the custom preview, which will be called after a delay when the user stops hovering over a pin.
		setPreviewTimeoutScheduler(() => {
			this.startHoverDelay(750, () => {
				hideCustomPreview();
			});
		});
	}

	// Initializes the pin interaction manager by loading pins from notes and setting up event listeners on the map wrapper.
	async init(): Promise<void> {

		// If the latitude or longitude range parameters are not defined, there's no valid area to place pins, so we can skip initialization.
		if (
			this.parameters.latitudeRange == null ||
			this.parameters.longitudeRange == null
		) {
			return;
		}

		// Set the current map dimensions based on the wrapper element's size, which will be used for calculating pin positions.
		this.currentMap.width = this.wrapper.clientWidth;
		this.currentMap.height = this.wrapper.clientHeight;

		// Initialize the latitude and longitude bounds based on the provided parameters, which will be used for validating pin locations and converting between location and pixel coordinates.
		this.latBounds = {
			min: this.parameters.latitudeRange[0],
			max: this.parameters.latitudeRange[1],
		};

		this.lngBounds = {
			min: this.parameters.longitudeRange[0],
			max: this.parameters.longitudeRange[1],
		};

		// Load all markdown files in the vault and create pins for those that have valid location front matter, allowing them to be displayed on the map.
		const notes = this.app.vault.getMarkdownFiles();
		for (const note of notes) {
			await this.createPin(note);
		}

		// Set up event listeners on the map wrapper to handle pointer movements, releases, and leaving the area, which will manage pin dragging and interactions.
		this.wrapper.addEventListener("pointermove", this.onWrapperPointerMove);
		this.wrapper.addEventListener("pointerup", this.onWrapperPointerUp);
		this.wrapper.addEventListener("pointerleave", this.onWrapperPointerLeave);
	}

	// Updates the positions of all pins on the map based on the current offsets and tile dimensions, ensuring that they are displayed in the correct locations as the map is panned or zoomed.
	updatePinPositions(
		offsetX: number,
		offsetY: number,
		tileWidth: number,
		tileHeight: number
	): void {

		// Update the current map dimensions and offsets, which will be used for calculating the new positions of the pins.
		this.currentMap.width = tileWidth;
		this.currentMap.height = tileHeight;
		this.currentMap.xOffset = offsetX;
		this.currentMap.yOffset = offsetY;

		// Loop through all pins and update their CSS styles to reflect their new positions based on the current map offsets and dimensions, skipping the currently selected pin if one is being dragged.
		for (const pin of this.pins) {
			if (pin === this.selectedPin) continue;

			const px = this.locationToPx(pin.location);

			pin.element.setCssStyles({
				left: `${this.wrapValue(px.left + offsetX, tileWidth)}px`,
				top: `${this.wrapValue(px.top + offsetY, tileHeight)}px`,
			});
		}
	}

	// Clears any existing hover delay by canceling the scheduled timeout, preventing the preview from hiding if the user interacts with a pin or moves the mouse back over it.
	clearHoverDelay(): void {
		if (this.hoverTimeout !== null) {
			window.clearTimeout(this.hoverTimeout);
			this.hoverTimeout = null;
		}
	}

	// Returns the live pin list. Used by the toolbar's search controller for things like centering the map on a chosen suggestion.
	getPins(): Pin[] {
		return this.pins;
	}

	// Apply a search query: hides pins that don't match and records, for the ones that do, which property triggered the match so the preview can surface it.
	applySearch(query: string): void {
		const ast = parseSearchQuery(query);

		for (const pin of this.pins) {
			if (!ast) {
				pin.matchInfo = null;
				pin.element.removeClass("sm-pin-hidden");
				continue;
			}

			const match = evaluateSearch(ast, pin);
			if (match) {
				pin.matchInfo = match;
				pin.element.removeClass("sm-pin-hidden");
			} else {
				pin.matchInfo = null;
				pin.element.addClass("sm-pin-hidden");
			}
		}
	}

	// Generate suggestion items for the autocomplete dropdown. Each suggestion identifies a pin and the specific property/value snippet that matched.
	getSuggestions(query: string, limit = 8): PinSearchSuggestion[] {
		const ast = parseSearchQuery(query);
		if (!ast) return [];

		const results: PinSearchSuggestion[] = [];
		for (const pin of this.pins) {
			const match = evaluateSearch(ast, pin);
			if (!match) continue;
			results.push({
				pin,
				label: pin.note.basename,
				property: match.property,
				value: match.value,
			});
			if (results.length >= limit) break;
		}
		return results;
	}

	// Build a flat, lower-cased searchable representation of a note: name, aliases, tags, and every other frontmatter property. Stored so applySearch and getSuggestions can run synchronously over many pins without re-reading the metadata cache each keystroke.
	private buildSearchIndex(
		note: TFile,
		frontMatter: FrontMatterCache
	): { property: string; rawValue: string; haystack: string }[] {
		const entries: { property: string; rawValue: string; haystack: string }[] = [];

		const push = (property: string, value: unknown) => {
			if (value == null) return;
			const rawValue = Array.isArray(value)
				? value.map((v) => String(v)).join(", ")
				: String(value);
			if (!rawValue.length) return;
			entries.push({
				property,
				rawValue,
				haystack: rawValue.toLowerCase(),
			});
		};

		push("name", note.basename);

		// Aliases can be a string or an array depending on how the user wrote them. Normalize each one as its own indexable entry so a search can hit a single alias precisely.
		const aliases = frontMatter.aliases ?? frontMatter.alias;
		if (Array.isArray(aliases)) {
			for (const a of aliases) push("alias", a);
		} else if (aliases != null) {
			push("alias", aliases);
		}

		// Tags can come from frontmatter as `tag`/`tags` (string or array, possibly with leading `#`).
		const tags = frontMatter.tags ?? frontMatter.tag;
		const pushTag = (t: unknown) => {
			if (t == null) return;
			const stripped = String(t).replace(/^#/, "");
			push("tag", stripped);
		};
		if (Array.isArray(tags)) {
			for (const t of tags) pushTag(t);
		} else if (tags != null) {
			// Frontmatter tags written as a single string can be comma- or space-separated.
			for (const t of String(tags).split(/[,\s]+/)) pushTag(t);
		}

		// Every other frontmatter key, except the ones we already indexed and Obsidian/plugin internals.
		const skip = new Set([
			"aliases",
			"alias",
			"tags",
			"tag",
			"position",
			"sm-location",
			"sm-id",
			"sm-pin-icon",
		]);
		for (const key of Object.keys(frontMatter)) {
			if (skip.has(key)) continue;
			push(key, (frontMatter as Record<string, unknown>)[key]);
		}

		return entries;
	}

	// Destroys the pin interaction manager by removing event listeners, clearing pins from the map, and resetting state, allowing for cleanup when the map is no longer needed or is being reinitialized.
	destroy(): void {

		// Clear any existing hover delay to prevent the preview from lingering after the manager is destroyed.
		this.clearHoverDelay();
		this.wrapper.removeEventListener("pointermove", this.onWrapperPointerMove);
		this.wrapper.removeEventListener("pointerup", this.onWrapperPointerUp);
		this.wrapper.removeEventListener("pointerleave", this.onWrapperPointerLeave);

		// Remove all pin elements from the DOM and clear the pins array, resetting the state of the manager.
		for (const pin of this.pins) {
			pin.element.remove();
		}

		// Reset the pins array and selected pin state, and destroy any existing custom preview to ensure a clean slate.
		this.pins = [];
		this.selectedPin = null;
		this.pointerStartPos = null;
		this.pinDragging = false;
		destroyCustomPreview();
	}

	// Creates a pin for a given note if it has valid location front matter, adding it to the map and setting up its interactions based on the note's metadata and the plugin's parameters.
	private async createPin(note: TFile): Promise<void> {

		// Retrieve the front matter cache for the note to access its metadata, and check for the presence of the required location field. If the location field is missing, we cannot create a pin for this note.
		const cache = this.app.metadataCache.getFileCache(note);
		const frontMatter = cache?.frontmatter;
		if (!frontMatter) return;

		// Check for the presence of the location field in the front matter, which is required to create a pin. If it's missing, we cannot proceed with creating a pin for this note.
		const frontMatterLocation = frontMatter["sm-location"] as string;
		if (frontMatterLocation === undefined) return;

		// If the plugin parameters specify a list of allowed map IDs, check if the note's front matter contains a matching ID. If it doesn't match, we should not create a pin for this note.
		const mapIDs = this.parameters.mapIDs ?? [];
		if (mapIDs.length > 0 && mapIDs[0] !== "") {
			const mapId = frontMatter["sm-id"] as string;
			if (mapId == null || !mapIDs.includes(String(mapId))) return;
		}

		// Parse the location from the front matter and validate that it falls within the defined latitude and longitude bounds. If the location is invalid or out of bounds, we should not create a pin for this note.
		const location = this.parseFormattedLocation(String(frontMatterLocation));
		if (!location) return;

		// Validate that the parsed location falls within the defined latitude and longitude bounds. If it is outside of these bounds, we should not create a pin for this note.
		if (
			location.lat < this.latBounds.min ||
			location.lat > this.latBounds.max ||
			location.lng < this.lngBounds.min ||
			location.lng > this.lngBounds.max
		) return;

		// Create a new pin element on the map for this note, positioning it based on the parsed location and applying the appropriate icon and size based on the note's front matter and plugin parameters.
		const pinElement = this.wrapper.createEl("div", { cls: "sm-pin" });

		// Convert the location to pixel coordinates and format them for CSS styling, then apply the styles to position the pin element on the map.
		const formattedPx = this.formatPx(this.locationToPx(location));
		pinElement.setCssStyles({
			left: formattedPx.left,
			top: formattedPx.top,
		});

		// Create a child element within the pin element to hold the icon, and determine which icon to use based on the note's front matter. If a custom icon is specified and can be resolved, use it; otherwise, fall back to the default pin icon.
		const pinIconEl = pinElement.createEl("div", { cls: "sm-pin-icon" });

		// Attempt to resolve a custom pin icon file based on the note's front matter, using the provided value to find a linked file or a file by name in the vault. If a valid file is found, it will be used as the pin icon.
		const pinIconValue: unknown = frontMatter["sm-pin-icon"] as string;
		const pinFile = this.resolvePinIconFile(
			this.app,
			pinIconValue,
			this.ctx.sourcePath
		);

		// Create a DOMParser instance to parse SVG content if a custom SVG icon is used, allowing us to manipulate the SVG and add padding to the viewBox for better display on the map.
		const parser = new DOMParser();

		// If a custom pin file was resolved, check its extension to determine how to display it. If it's an SVG, read its content and add padding to the viewBox before displaying it. If it's a raster image, create an img element with the appropriate source URL.
		if (pinFile) {
			if (pinFile.extension.toLowerCase() === "svg") {

				// For SVG icons, read the file content, add padding to the viewBox for better display, and parse it into an SVG document to be used as the pin icon.
				const customPinIcon = this.addSvgViewBoxPadding(
					await this.app.vault.cachedRead(pinFile),
					2
				);
				const customSVGDoc = parser.parseFromString(
					customPinIcon,
					"image/svg+xml"
				);
				pinIconEl.replaceChildren(customSVGDoc.documentElement);
			} else {

				// For raster images, get the resource path for the file and create an img element to display it as the pin icon.
				const url = this.app.vault.getResourcePath(pinFile);
				pinIconEl.createEl("img", {
					attr: {
						src: url,
						alt: "",
					},
				});
			}

			// If no custom pin file was resolved, use the default pin icon by parsing the embedded SVG content and adding padding to the viewBox for better display.
		} else {
			const defaultPaddedSVG = this.addSvgViewBoxPadding(defaultPinIcon, 2);
			const defaultSVGDoc = parser.parseFromString(
				defaultPaddedSVG,
				"image/svg+xml"
			);
			pinIconEl.replaceChildren(defaultSVGDoc.documentElement);
		}

		// Determine the size of the pin icon based on the plugin parameters, allowing for percentage-based sizing relative to the map dimensions or fixed sizes using CSS units.
		const match = this.parameters.pinSize.trim().match(
			/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/
		);

		// If the pin size is specified as a percentage, calculate the width based on the current map width and apply it to the pin icon. Otherwise, use the specified size directly as a CSS value.
		if (match) {
			pinIconEl.setCssStyles({
				width: `${Number(match[1]) * 0.01 * this.currentMap.width}px`,
			});

			// If the pin size is not a percentage, apply it directly as a CSS width value, allowing for fixed sizes using units like pixels or rem.
		} else {
			pinIconEl.setCssStyles({
				width: this.parameters.pinSize,
			});
		}

		// Create a new Pin object to represent this pin on the map, including its associated note, DOM element, and location. Then initialize its interactions and add it to the list of pins managed by the controller.
		const newPin: Pin = {
			note,
			element: pinElement,
			location,
			searchIndex: this.buildSearchIndex(note, frontMatter),
			matchInfo: null,
		};

		// Initialize the interactions for the new pin, setting up event listeners for hover and click events to show previews and allow dragging. Then add the new pin to the pins array for management.
		this.initPinActions(newPin);
		this.pins.push(newPin);
	}

	// Initializes the interactions for a given pin, setting up event listeners for pointer enter, leave, and down events to manage hover previews and dragging behavior based on the user's interactions with the pin element.
	private initPinActions(pin: Pin): void {

		// When the pointer enters the pin element, check if a pin is already selected or if the preview should be suppressed. If not, start a hover delay to show the custom preview for this pin after a short delay.
		pin.element.addEventListener("pointerenter", (e) => {
			if (this.selectedPin || this.shouldSuppressPreview()) return;

			this.startHoverDelay(100, () => {
				void showCustomPreview(pin, this.app, this.component, e);
			});
		});

		// When the pointer leaves the pin element, start a hover delay to hide the custom preview after a short delay, allowing for a smoother user experience when moving the mouse away from the pin.
		pin.element.addEventListener("pointerleave", () => {
			this.startHoverDelay(750, () => {
				hideCustomPreview();
			});
		});

		// When the pointer is pressed down on the pin element, check if a pin is already selected. If not, stop propagation of the event, clear any existing hover delay, hide the custom preview, and set this pin as the selected pin for potential dragging.
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

	// Starts a hover delay by clearing any existing delay and setting a new timeout to execute the provided callback function after the specified time, allowing for controlled showing and hiding of the custom preview based on user interactions.
	private startHoverDelay(time: number, callback: () => void): void {
		this.clearHoverDelay();
		this.hoverTimeout = window.setTimeout(() => {
			this.hoverTimeout = null;
			callback();
		}, time);
	}

	// Suppresses the preview by setting a timestamp until which the preview should be suppressed, preventing it from showing during certain interactions such as dragging or immediately after clicking a pin.
	private suppressPreview(ms: number): void {
		this.suppressPreviewUntil = Date.now() + ms;
	}

	// Checks if the preview should currently be suppressed by comparing the current time to the suppressPreviewUntil timestamp, returning true if the preview should be suppressed and false otherwise.
	private shouldSuppressPreview(): boolean {
		return Date.now() < this.suppressPreviewUntil;
	}

	// Resolves a pin icon file based on the provided value, which can be a string representing a linked file, a file path, or a file name. The function attempts to find a matching TFile in the vault and returns it if found, or null if no valid file is resolved.
	private resolvePinIconFile(
		app: App,
		value: unknown,
		sourcePath: string
	): TFile | null {

		// If the value is not a string, we cannot resolve it to a file, so return null.
		if (typeof value !== "string") return null;

		// Trim the value and check if it's empty. If it is, return null since we cannot resolve an empty string to a file.
		const raw = value.trim();
		if (!raw) return null;

		// Attempt to resolve the value as a linked file path using Obsidian's metadata cache. If a linked file is found and it's a TFile, return it.
		const normalized = raw.replace(/^\[\[|\]\]$/g, "").trim();
		if (!normalized) return null;

		// First, try to resolve the value as a linked file path relative to the source note. This allows users to specify icons using Obsidian's internal linking syntax, making it easy to reference files in the vault.
		const linked = app.metadataCache.getFirstLinkpathDest(normalized, sourcePath);
		if (linked instanceof TFile) return linked ?? null;

		// If the linked file resolution did not find a valid TFile, attempt to resolve the value as a direct file path in the vault. This allows users to specify icons using absolute or relative paths, providing flexibility in how icons are referenced.
		const byPath = app.vault.getAbstractFileByPath(normalizePath(normalized));
		if (byPath instanceof TFile) return byPath ?? null;

		// If the value cannot be resolved as a linked file or a direct path, attempt to find a file in the vault with a matching name or basename, checking for supported image extensions. This allows users to specify icons by name, which can be convenient if they have a small number of files in the vault.
		const files = app.vault.getFiles();
		const lower = normalized.toLowerCase();

		// Define a set of supported image file extensions for pin icons, which will be used to filter potential matches when resolving a file by name. This ensures that only valid image files are considered for use as pin icons.
		const supportedExts = new Set(["svg", "png", "jpg", "jpeg", "webp", "gif"]);

		// First, try to find an exact name match for the file, checking if the extension is one of the supported image formats. This allows for precise matching when the user specifies a file name that includes the extension.
		const exactName = files.find((f) => f.name.toLowerCase() === lower);
		if (exactName && supportedExts.has(exactName.extension.toLowerCase())) {
			return exactName ?? null;
		}

		// If no exact name match is found, try to find files with a matching basename (name without extension) and a supported image extension. If multiple matches are found, prefer an SVG file if available, as it will generally provide better scaling and appearance for pin icons.
		const basenameMatches = files.filter(
			(f) =>
				f.basename.toLowerCase() === lower &&
				supportedExts.has(f.extension.toLowerCase())
		);

		// If there is exactly one basename match, return it. This allows for convenient matching when the user specifies a file name without the extension, as long as there is only one file with that basename.
		if (basenameMatches.length === 1) return basenameMatches[0] ?? null;

		// If there are multiple basename matches, prefer an SVG file if one is available, as it will generally provide better scaling and appearance for pin icons. If no SVG match is found, return the first match in the list.
		const svgMatch = basenameMatches.find(
			(f) => f.extension.toLowerCase() === "svg"
		);

		// If an SVG match is found among the basename matches, return it. Otherwise, return the first match in the list of basename matches, or null if there are no matches. This allows for a reasonable fallback when multiple files share the same basename, prioritizing SVGs for their advantages as pin icons.
		if (svgMatch) return svgMatch ?? null;

		// If there are multiple basename matches but no SVG is found, return the first match. This provides a fallback option when the user specifies a basename that corresponds to multiple files, ensuring that at least one file is returned if there are matches.
		return basenameMatches[0] ?? null;
	}

	// Adds padding to the viewBox of an SVG string by parsing the viewBox attribute and adjusting its values to create a larger viewBox that includes the specified padding. This can help improve the appearance of pin icons by ensuring they have some space around them when rendered on the map.
	private addSvgViewBoxPadding(svg: string, pad: number): string {
		return svg.replace(/viewBox="([^"]+)"/, (_match, vb: string) => {

			// Parse the viewBox values into numbers and validate that they are in the correct format. If the viewBox does not have exactly four numeric values, return it unchanged to avoid breaking the SVG.
			const parts = vb.trim().split(/\s+/).map((part) => Number(part));
			if (
				parts.length !== 4 ||
				parts.some((value) => value === undefined || Number.isNaN(value))
			) {
				return `viewBox="${vb}"`;
			}

			// Destructure the viewBox values into x, y, width, and height, and add padding to each side by adjusting the x and y values and increasing the width and height accordingly. This creates a new viewBox that includes the original content plus the specified padding around it.
			let [x, y, w, h] = parts;
			x ??= 0;
			y ??= 0;
			w ??= 500;
			h ??= 500;

			// Return the new viewBox string with the adjusted values, ensuring that the SVG will have padding around its content when rendered. This can help improve the visibility and appearance of pin icons on the map.
			return `viewBox="${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}"`;
		});
	}

	// Formats a Location object into a string representation suitable for storing in front matter, using a consistent format with four decimal places for latitude and longitude. This allows for easy parsing and display of location data in the notes.
	private formatLocation(location: Location): string {
		return `(${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
	}

	// Parses a formatted location string from front matter into a Location object, using a regular expression to extract the latitude and longitude values. If the string is not in the correct format or contains invalid numbers, the function returns null to indicate that the location could not be parsed.
	private parseFormattedLocation(formattedLocation: string): Location | null {

		// Use a regular expression to match the expected format of the location string, which should be in the form of "(lat, lng)" with optional whitespace and support for decimal numbers. If the string does not match this format, return null.
		const match = formattedLocation.match(
			/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/
		);
		if (!match) return null;

		// Parse the latitude and longitude values from the matched groups and convert them to numbers. If either value is not a valid number, return null to indicate that the location could not be parsed.
		const location = {
			lat: Number(match[1]),
			lng: Number(match[2]),
		};

		// Validate that the parsed latitude and longitude values are valid numbers. If either value is NaN, return null to indicate that the location is invalid.
		if (Number.isNaN(location.lat) || Number.isNaN(location.lng)) return null;
		return location;
	}

	// Converts a Position object with numeric left and top values into a FormattedPosition object with pixel values as strings, suitable for applying as CSS styles to position elements on the map. This allows for consistent formatting of pixel positions when updating pin locations.
	private formatPx(px: Position): FormattedPosition {
		return {
			left: `${px.left}px`,
			top: `${px.top}px`,
		};
	}

	// Converts a Location object with latitude and longitude values into a Position object with left and top pixel values based on the current map dimensions and bounds. This allows for calculating the pixel position of a pin on the map based on its geographic location.
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

	// Converts a Position object with left and top pixel values into a Location object with latitude and longitude values based on the current map dimensions and bounds. This allows for calculating the geographic location of a pin on the map based on its pixel position.
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

	// Converts mouse event coordinates to pixel positions relative to the map wrapper element, allowing for accurate tracking of pointer movements and interactions with pins on the map.
	private mouseToPx(event: MouseEvent | PointerEvent, rect: DOMRect): Position {
		return {
			left: event.clientX - rect.left,
			top: event.clientY - rect.top,
		};
	}

	// Wraps a number n within the range of 0 to m, allowing for seamless wrapping of pin positions when they move beyond the edges of the map. This is used to ensure that pins can wrap around the map boundaries correctly based on the defined latitude and longitude ranges.
	private wrapValue(n: number, m: number): number {
		return ((n % m) + m) % m;
	}
}

// Search query AST. Built once per query string and then evaluated against each pin. Adjacent terms with no operator default to AND, matching the way most search UIs behave.
type SearchTerm = { kind: "term"; text: string };
type SearchAnd = { kind: "and"; children: SearchNode[] };
type SearchOr = { kind: "or"; children: SearchNode[] };
type SearchNode = SearchTerm | SearchAnd | SearchOr;

// Tokenize the raw query string. Quoted runs ("...") are a single term that may contain spaces and operator-like characters; bare runs split on whitespace; `&&`/`and`/`||`/`or` become operator tokens.
type Token =
	| { type: "term"; value: string }
	| { type: "and" }
	| { type: "or" };

function tokenizeSearchQuery(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < input.length) {
		const ch = input[i];

		if (ch === " " || ch === "\t" || ch === "\n") {
			i++;
			continue;
		}

		if (ch === '"') {
			let j = i + 1;
			let value = "";
			while (j < input.length && input[j] !== '"') {
				value += input[j];
				j++;
			}
			if (value.length > 0) tokens.push({ type: "term", value });
			i = j < input.length ? j + 1 : j;
			continue;
		}

		if (input.startsWith("&&", i)) {
			tokens.push({ type: "and" });
			i += 2;
			continue;
		}

		if (input.startsWith("||", i)) {
			tokens.push({ type: "or" });
			i += 2;
			continue;
		}

		// Bare word: read until whitespace or quote. We then check if the bare word itself is an `and`/`or` keyword.
		let j = i;
		while (
			j < input.length &&
			input[j] !== " " &&
			input[j] !== "\t" &&
			input[j] !== "\n" &&
			input[j] !== '"'
			) {
			j++;
		}
		const word = input.slice(i, j);
		const lower = word.toLowerCase();
		if (lower === "and") {
			tokens.push({ type: "and" });
		} else if (lower === "or") {
			tokens.push({ type: "or" });
		} else if (word.length > 0) {
			tokens.push({ type: "term", value: word });
		}
		i = j;
	}

	return tokens;
}

// Convert tokens into an AST with OR as the lowest-precedence operator and adjacent terms binding implicitly with AND. Returns null if the query is empty so callers can short-circuit to "no filter".
export function parseSearchQuery(input: string): SearchNode | null {
	const tokens = tokenizeSearchQuery(input);
	if (tokens.length === 0) return null;

	// Group tokens by OR. Within each group, every term/AND-token contributes to a single AND node.
	const orGroups: SearchNode[][] = [[]];
	let lastWasOperator = true;
	for (const tok of tokens) {
		if (tok.type === "or") {
			orGroups.push([]);
			lastWasOperator = true;
			continue;
		}
		if (tok.type === "and") {
			lastWasOperator = true;
			continue;
		}
		// term
		orGroups[orGroups.length - 1].push({ kind: "term", text: tok.value });
		lastWasOperator = false;
	}

	if (lastWasOperator && orGroups[orGroups.length - 1].length === 0) {
		// trailing operator with nothing after it — just drop the empty group
		orGroups.pop();
	}

	const andNodes: SearchNode[] = orGroups
		.filter((group) => group.length > 0)
		.map((group) =>
			group.length === 1 ? group[0] : { kind: "and", children: group }
		);

	if (andNodes.length === 0) return null;
	if (andNodes.length === 1) return andNodes[0];
	return { kind: "or", children: andNodes };
}

// Evaluate an AST against a pin. Returns the first PinMatchInfo that satisfies the query (so the preview can show *which* property matched), or null if no match.
export function evaluateSearch(node: SearchNode, pin: Pin): PinMatchInfo | null {
	if (node.kind === "term") {
		const needle = node.text.toLowerCase();
		if (!needle) return null;
		for (const entry of pin.searchIndex) {
			if (entry.haystack.includes(needle)) {
				return { property: entry.property, value: entry.rawValue };
			}
		}
		return null;
	}

	if (node.kind === "and") {
		// Every child must match. Return the most specific (last) match so the preview surfaces the most informative property the query touched.
		let last: PinMatchInfo | null = null;
		for (const child of node.children) {
			const m = evaluateSearch(child, pin);
			if (!m) return null;
			last = m;
		}
		return last;
	}

	// or
	for (const child of node.children) {
		const m = evaluateSearch(child, pin);
		if (m) return m;
	}
	return null;
}
