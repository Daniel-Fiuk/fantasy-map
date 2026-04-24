import {
	App,
	Component,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	Notice,
} from "obsidian";

import { FantasyMapSettings } from "./settings";

export interface FantasyMapParams {
	map: string;
	mapIDs: string[];
	pinSize: string;
	zoomRange: [number, number];
	defaultZoomIncrement: number;
	defaultZoomLevel: number;
	defaultLocation: [number, number];
	repeat: string;
	latitudeRange: [number, number];
	longitudeRange: [number, number];
	primeMeridianOffset: [number, number];
}

const mapHelpMessageString =
	"**\"map\"** (**required**): The name of the map asset to display. Supports relative paths, absolute paths, and bare filenames (e.g. \"World Map.svg\"). The file must be located somewhere in your vault. Supported file types are SVG, PNG, JPG, JPEG, WEBP, and GIF.";

const mapIDsHelpMessageString =
	"**\"id\"** (optional): A comma-separated list of IDs that determines which pins can appear on the map when they share the same ID (e.g. \"river, mountain\"). If not specified, all pins will be displayed on the map regardless of ID.";

const pinSizeHelpMessageString =
	"**\"pin size\"** (optional): The size of the pins on the map, specifically the width of the pin element (e.g. \"24px\", \"1.5em\", \"5%\"). Default: \"24px\". This can be adjusted in the plugin settings window.";

const zoomRangeHelpMessageString =
	"**\"zoom range\"** (optional): The zoom range controls how much a user can zoom in or out on the map element (e.g. (min, max)). Default: (1, 15), where zoom level 1 shows the full world view and 15 represents a close-in view at 1/15 of that scale. Minimum value must be equal to or greater than 1 and max value must be greater than the minimum value.";

const defaultZoomIncrementHelpMessageString =
	"**\"default zoom increment\"** (optional): The default zoom increment amount. Default: \"1\". This can be adjusted in the plugin settings window.";

const defaultZoomLevelHelpMessageString =
	"**\"default zoom level\"** (optional): The initial zoom level when the map is first loaded. Default: \"1\"";

const defaultLocationHelpMessageString =
	"**\"default location\"** (optional): The initial focused coordinates when the map loads, formatted as \"(latitude, longitude)\". Default: \"(0, 0)\"";

const repeatHelpMessageString =
	"**\"repeat\"** (optional): Indicates whether the map should repeat horizontally, vertically, or in both directions. Use ver/vertical/y, hor/horizontal/x, or both/b. Default: \"no-repeat\"";

const latitudeRangeHelpMessageString =
	"**\"latitude range\"** (optional): The latitude bounds, formatted as \"(min, max)\". Default: \"(-90, 90)\"";

const longitudeRangeHelpMessageString =
	"**\"longitude range\"** (optional): The longitude bounds, formatted as \"(min, max)\". Default: \"(0, 360)\"";

const primeMeridianOffsetHelpMessageString =
	"**\"prime meridian offset\"** (optional): The offset applied to latitude and longitude values, formatted as \"(latOffset, lngOffset)\". Default: \"(0, 0)\"";

const helpHelpMessageString =
	"**\"help, -h, onfo, instruction, -i, or usage\"**: Include one of these keywords to display usage instructions.";

function allHelpMessages(settings: FantasyMapSettings): string[] {
	return [
		mapHelpMessageString,
		mapIDsHelpMessageString,
		pinSizeHelpMessageString.replace('default: "24px"', `default: "${settings.defaultPinSize}"`),
		zoomRangeHelpMessageString,
		defaultZoomIncrementHelpMessageString.replace('default: "1"', `default: "${settings.defaultZoomIncrement}"`),
		defaultZoomLevelHelpMessageString,
		defaultLocationHelpMessageString,
		repeatHelpMessageString,
		latitudeRangeHelpMessageString,
		longitudeRangeHelpMessageString,
		primeMeridianOffsetHelpMessageString,
		helpHelpMessageString,
	];
}

export const fantasyMapCodeBlockCopyToClipboardString = [
	"```fantasy-map",
	"map:",
	"id:",
	"pin size:",
	"zoom range:",
	"default zoom increment:",
	"default zoom level:",
	"default location:",
	"repeat:",
	"latitude range:",
	"longitude range:",
	"prime meridian offset:",
	"```",
].join("\n");

export const fantasyMapFrontMatterCopyToClipboardString = [
	"---",
	"fm-location: (lat, lng)",
	"fm-id:",
	"fm-pin-icon:",
	"---",
].join("\n");

const affirmatives = [
	"yes",
	"y",
	"true",
	"t",
	"1",
	"on",
	"enable",
	"enabled",
	"ok",
	"okay",
	"sure",
	"yep",
	"yeah",
	"yea",
	"yup",
	"affirmative",
	"positive",
	"confirm",
	"confirmed",
];

const verticalRepeatAffirmatives = ["vertical", "vert", "ver", "vr", "v", "y"];
const horizontalRepeatAffirmatives = ["horizontal", "hori", "hor", "hr", "h", "x"];
const bothRepeatAffirmatives = ["both", "b"];

const helpKeywords = ["help", "-h", "info", "instruction", "-i", "usage"];

export function parseFantasyMapParams(
	app: App,
	source: string,
	element: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	component: Component,
	settings: FantasyMapSettings
): FantasyMapParams {
	const lines = source
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	const params: Partial<FantasyMapParams> = {};
	const helpMessages: string[] = [];

	const addHelpMessage = (message: string) => {
		if (!helpMessages.includes(message)) {
			helpMessages.push(message);
		}
	};

	if (lines.length === 0) {
		void fantasyMapHelpMessage(
			app,
			element,
			compileHelpMessages(
				allHelpMessages(settings),
				"##### Available fantasy-map parameters:"
			),
			true,
			ctx.sourcePath,
			component
		);
	}

	for (const line of lines) {
		if (helpKeywords.includes(line.toLowerCase())) {
			allHelpMessages(settings).forEach(addHelpMessage);
			continue;
		}

		if (!line.includes(":")) {
			addHelpMessage(
				`Fantasy Map Error: Invalid parameter format: "${line}"! Each parameter should be in the format "key: value".`
			);
			continue;
		}

		const [rawKey, ...rawValue] = line.split(":");
		if (!rawKey || rawValue.length === 0) continue;

		const key = rawKey.trim().replace(/\s+/g, "").toLowerCase();
		const value = rawValue.join(":").trim();

		const checkForHelp = (message: string): boolean => {
			const helpRequested = helpKeywords.includes(value.toLowerCase());
			if (helpRequested) addHelpMessage(message);
			return helpRequested;
		};

		if (helpKeywords.includes(key)) {
			allHelpMessages(settings).forEach(addHelpMessage);
			continue;
		}

		switch (key) {
			case "map":
				if (checkForHelp(mapHelpMessageString)) break;
				if (value.length === 0) {
					addHelpMessage('Fantasy Map Error: "Map" option is required!');
				}
				params.map = value;
				break;

			case "id":
				if (checkForHelp(mapIDsHelpMessageString)) break;
				params.mapIDs = value
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean);
				break;

			case "pinsize":
				if (
					checkForHelp(
						pinSizeHelpMessageString.replace(
							'default: "24px"',
							`default: "${settings.defaultPinSize}"`
						)
					)
				) {
					break;
				}

				if (value.length === 0) break;

				if (!isValidPinSize(value)) {
					addHelpMessage(
						"fantasy-map error: Pin size value is invalid! Examples: '24px', '1.5rem', '5%', '10vw', or '0'."
					);
					break;
				}

				params.pinSize = value;
				break;
				
			case "zoomrange":
				if (checkForHelp(zoomRangeHelpMessageString)) break;
				params.zoomRange = parseCoordsAndRanges(value, [1, 15]);
				if (params.zoomRange[0] < 1) params.zoomRange[0] = 1;
				if (params.zoomRange[1] < params.zoomRange[0]) params.zoomRange[1] = params.zoomRange[0];
				break;

			case "defaultzoomincrement":
				if (
					checkForHelp(
						defaultZoomIncrementHelpMessageString.replace(
							'default: "1"',
							`default: "${settings.defaultZoomIncrement}"`
						)
					)
				) {
					break;
				}
				params.defaultZoomIncrement = Number(value) || 1;
				break;

			case "defaultzoomlevel":
				if (checkForHelp(defaultZoomLevelHelpMessageString)) break;
				params.defaultZoomLevel = Number(value) > 0 ? Number(value) : 1;
				break;

			case "defaultlocation":
				if (checkForHelp(defaultLocationHelpMessageString)) break;
				params.defaultLocation = parseCoordsAndRanges(value, [0, 0]);
				break;

			case "repeat": {
				if (checkForHelp(repeatHelpMessageString)) break;
				const normalizedValue = value.toLowerCase();

				if (verticalRepeatAffirmatives.includes(normalizedValue)) {
					params.repeat = "repeat-y";
				} else if (
					affirmatives.includes(normalizedValue) ||
					horizontalRepeatAffirmatives.includes(normalizedValue)
				) {
					params.repeat = "repeat-x";
				} else if (bothRepeatAffirmatives.includes(normalizedValue)) {
					params.repeat = "repeat";
				} else {
					params.repeat = "no-repeat";
				}
				break;
			}

			case "latituderange":
				if (checkForHelp(latitudeRangeHelpMessageString)) break;
				params.latitudeRange = parseCoordsAndRanges(value, [-90, 90]);
				if (params.latitudeRange[1] < params.latitudeRange[0]) params.latitudeRange[1] = params.latitudeRange[0] + 100
				break;

			case "longituderange":
				if (checkForHelp(longitudeRangeHelpMessageString)) break;
				params.longitudeRange = parseCoordsAndRanges(value, [0, 360]);
				if (params.longitudeRange[1] > params.longitudeRange[0]) params.longitudeRange[1] = params.longitudeRange[1] + 100
				break;

			case "primemeridianoffset":
				if (checkForHelp(primeMeridianOffsetHelpMessageString)) break;
				params.primeMeridianOffset = parseCoordsAndRanges(value, [0, 0]);
				break;

			default:
				console.warn(`Unknown fantasy-map parameter: "${rawKey}"`);
				addHelpMessage(
					`Unknown parameter: "${rawKey}"! Please check for typos and make sure you are using the correct parameter names.`
				);
				break;
		}
	}

	const finalParams: FantasyMapParams = {
		map: params.map ?? "",
		mapIDs: params.mapIDs ?? [],
		pinSize: params.pinSize && params.pinSize.length > 0 ? params.pinSize : settings.defaultPinSize,
		zoomRange: params.zoomRange ?? [1, 15],
		defaultZoomIncrement: params.defaultZoomIncrement ?? settings.defaultZoomIncrement,
		defaultZoomLevel: params.defaultZoomLevel ?? 1,
		defaultLocation: params.defaultLocation ?? [0, 0],
		repeat: params.repeat ?? "no-repeat",
		latitudeRange: params.latitudeRange ?? [-90, 90],
		longitudeRange: params.longitudeRange ?? [0, 360],
		primeMeridianOffset: params.primeMeridianOffset ?? [0, 0]
	};

	if (helpMessages.length > 0) {
		void fantasyMapHelpMessage(
			app,
			element,
			compileHelpMessages(helpMessages, "##### Fantasy-map help messages:"),
			true,
			ctx.sourcePath,
			component
		);
	}

	return finalParams;
}

function parseCoordsAndRanges(
	coords: string,
	defaultVal: [number, number]
): [number, number] {
	const match = coords.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/);
	return match ? [Number(match[1]), Number(match[2])] : defaultVal;
}

export function isValidPinSize(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;

	const el = document.createElement("div");
	el.setCssStyles({ width: "" });
	el.setCssStyles({ width: trimmed });

	const result = el.style.width !== "";
	el.remove();

	return result;
}

export async function fantasyMapHelpMessage(
	app: App,
	element: HTMLElement,
	message: string | null,
	includeCopyLink: boolean = false,
	sourcePath: string,
	component: Component
) {
	if (message == null) return;

	const container = element.createDiv();
	await MarkdownRenderer.render(app, message, container, sourcePath, component);

	if (includeCopyLink) appendCopyLink(container);
}

export function appendCopyLink(container: HTMLElement) {
	const wrapper = container.createDiv({ cls: "Fantasy-map-copy-link" });
	const link = wrapper.createEl("a", {
		text: "Copy fantasy-map template",
		href: "#",
	});

	link.addEventListener("click", (event) => {
		void handleCopyClick(event);
	});

	async function handleCopyClick(event: MouseEvent) {
		event.preventDefault();

		try {
			await navigator.clipboard.writeText(fantasyMapCodeBlockCopyToClipboardString);
			link.setText("Copied");
			new Notice("Fantasy-map template copied");
			window.setTimeout(() => {
				link.setText("Copy fantasy-map template");
			}, 1500);
		} catch (err) {
			console.warn("Fantasy-map copy failed", err);
			new Notice("Failed to copy fantasy-map template");
		}
	}
}

export function compileHelpMessages(
	messages: string[],
	title: string
): string | null {
	if (messages.length === 0) return null;

	const output = [title];
	messages.forEach((m) => output.push(`- ${m}`));
	return output.join("\n");
}
