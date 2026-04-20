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
	defaultZoomIncrement: number;
	defaultZoomLevel: number;
	defaultLocation: [number, number];
	repeat: string;
	latitudeRange: [number, number];
	longitudeRange: [number, number];
	primeMeridianOffset: [number, number];
}

const mapHelpMessageString =
	"**\"Map\"** (**required**): The name of the map asset to display - supports relative paths, absolute paths, and bare filenames (e.g. \"World Map.svg\") - the file must be located somewhere in your vault - supported file types are SVG, PNG, JPG, JPEG, WEBP, and GIF";

const mapIDsHelpMessageString =
	"**\"Map IDs\"** (optional): A comma-separated list of IDs that define which pins with the same ID can appear on the map (e.g. \"river, mountain\"); if not specified, all pins will be displayed on the map regardless of their ID";

const pinSizeHelpMessageString =
	"**\"Pin Size\"** (optional): The size of the pins on the map, specifically the width of the pin element (e.g. \"24px\", \"1.5em\", \"5%\") – default: \"24px\", can be adjusted in the plugin settings window";

const defaultZoomIncrementHelpMessageString =
	"**\"Default Zoom Increment\"** (optional): The zoom increment amount – default: \"1\", can be adjusted in the plugin settings window";

const defaultZoomLevelHelpMessageString =
	"**\"Default Zoom Level\"** (optional): The initial zoom level when the map is first loaded – default: \"1\"";

const defaultLocationHelpMessageString =
	"**\"Default Location\"** (optional): The initial focused coordinates for the map on load \"(latitude, longitude)\" – default: \"(0, 0)\"";

const repeatHelpMessageString =
	"**\"Repeat\"** (optional): Indicates if the map should be repeated horizontally, vertically, or in both directions. Use ver/vertical/y, hor/horizontal/x, or both/b – default: \"no-repeat\"";

const latitudeRangeHelpMessageString =
	"**\"Latitude Range\"** (optional): The latitude bounds as \"(min, max)\" – default: \"(-90, 90)\"";

const longitudeRangeHelpMessageString =
	"**\"Longitude Range\"** (optional): The longitude bounds as \"(min, max)\" – default: \"(0, 360)\"";

const primeMeridianOffsetHelpMessageString =
	"**\"Prime Meridian Offset\"** (optional): Offset for latitude and longitude values as \"(latOffset, lngOffset)\" – default: \"(0, 0)\"";

const helpHelpMessageString =
	"**\"Help, -H, Info, Instruction, -I, or Usage\"**: Include one of these keywords to display usage instructions";

function allHelpMessages(settings: FantasyMapSettings): string[] {
	return [
		mapHelpMessageString,
		mapIDsHelpMessageString,
		pinSizeHelpMessageString.replace(
			'default: "24px"',
			`default: "${settings.defaultPinSize}"`
		),
		defaultZoomIncrementHelpMessageString.replace(
			'default: "1"',
			`default: "${settings.defaultZoomIncrement}"`
		),
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
	"```Fantasy-Map",
	"Map:",
	"MapIDs:",
	"PinSize:",
	"Default Zoom Increment:",
	"Default Zoom Level:",
	"Default Location:",
	"Repeat:",
	"Latitude Range:",
	"Longitude Range:",
	"Prime Meridian Offset:",
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
				"##### Available Fantasy-Map parameters:"
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

			case "mapids":
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
						"Fantasy-Map error: Pin size value is invalid! Examples: '24px', '1.5rem', '5%', '10vw', or '0'."
					);
					break;
				}

				params.pinSize = value;
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
				params.defaultLocation = parseCoords(value, [0, 0]);
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
				params.latitudeRange = parseCoords(value, [-90, 90]);
				break;

			case "longituderange":
				if (checkForHelp(longitudeRangeHelpMessageString)) break;
				params.longitudeRange = parseCoords(value, [0, 360]);
				break;

			case "primemeridianoffset":
				if (checkForHelp(primeMeridianOffsetHelpMessageString)) break;
				params.primeMeridianOffset = parseCoords(value, [0, 0]);
				break;

			default:
				console.warn(`Unknown Fantasy-Map parameter: "${rawKey}"`);
				addHelpMessage(
					`Unknown parameter: "${rawKey}"! Please check for typos and make sure you are using the correct parameter names.`
				);
				break;
		}
	}

	const finalParams: FantasyMapParams = {
		map: params.map ?? "",
		mapIDs: params.mapIDs ?? [],
		pinSize:
			params.pinSize && params.pinSize.length > 0
				? params.pinSize
				: settings.defaultPinSize,
		defaultZoomIncrement:
			params.defaultZoomIncrement ?? settings.defaultZoomIncrement,
		defaultZoomLevel: params.defaultZoomLevel ?? 1,
		defaultLocation: params.defaultLocation ?? [0, 0],
		repeat: params.repeat ?? "no-repeat",
		latitudeRange: params.latitudeRange ?? [-90, 90],
		longitudeRange: params.longitudeRange ?? [0, 360],
		primeMeridianOffset: params.primeMeridianOffset ?? [0, 0],
	};

	if (helpMessages.length > 0) {
		void fantasyMapHelpMessage(
			app,
			element,
			compileHelpMessages(helpMessages, "##### Fantasy-Map help messages:"),
			true,
			ctx.sourcePath,
			component
		);
	}

	return finalParams;
}

function parseCoords(
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
	const wrapper = container.createDiv({ cls: "fantasy-map-copy-link" });
	const link = wrapper.createEl("a", {
		text: "Copy Fantasy-Map template",
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
			new Notice("Fantasy-Map template copied");
			window.setTimeout(() => {
				link.setText("Copy Fantasy-Map template");
			}, 1500);
		} catch (err) {
			console.warn("Fantasy-Map copy failed", err);
			new Notice("Failed to copy Fantasy-Map template");
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
