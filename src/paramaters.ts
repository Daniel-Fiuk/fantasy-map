import { App, Component, MarkdownRenderer, MarkdownPostProcessorContext } from "obsidian";
import { FantasyMapSettings } from "./settings";

// This interface defines the structure of the parameters that can be passed to the map renderer, including the required "map" parameter and various optional parameters with their corresponding types
export interface FantasyMapParams {
	map: string;
	mapIDs: string[];
	pinSize: string;
	defaultZoomIncrement?: number;
	defaultZoomLevel?: number;
	defaultLocation?: [number, number];
	repeat?: string;
	latitudeRange?: [number, number];
	longitudeRange?: [number, number];
	longitudeOffset?: number;
	unitOfMeasurement?: string;
	equatorialCircumference?: number;
}

// Help message strings for each parameter, which will be displayed when the user includes a help keyword in the value of any parameter; these messages provide detailed instructions on how to use each parameter and what values are accepted
const mapHelpMessageString = "**\"Map\"** (**required**): The name of the map asset to display - supports relative paths, absolute paths, and bare filenames (e.g. \"World Map.svg\") - the file must be located somewhere in your vault - supported file types are SVG, PNG, JPG, JPEG, WEBP, and GIF"
const mapIDsHelpMessageString = "**\"Map IDs\"** (optional): A comma-separated list of IDs that define which pins with the same ID can appear on the map (e.g. \"river, mountain\"); if not specified, all pins will be displayed on the map regardless of their ID";
const pinSizeHelpMessageString = "**\"Pin Size\"** (optional): The size of the pins on the map. Specificaly the width of the pin element, (e.g. \"24px\", \"1.5em\", etc.) – default: \"24px\", can be adjusted in the plugin settings window";
const defaultZoomIncrementHelpMessageString = "**\"Default Zoom Increment\"** (optional): The zoom increment amount – default: \"1\", can be adjusted in the plugin settings window";
const defaultZoomLevelHelpMessageString = "**\"Default Zoom Level\"** (optional): The initial zoom level when the map is first loaded – default: \"1\"";
const defaultLocationHelpMessageString = "**\"Default Location\"** (optional): The initial focused coordinates for the map on load \"(latitude, longitude)\" – default: \"(0, 0)\"";
const repeatHelpMessageString = "**\"Repeat\"** (optional): Indicates if the map should be repeated horizontally, vertically, or in both directions (accepts yes/no, true/false, etc.; defaults to horizontal repetition. Use ver/vertical/y, hor/horizontal/x, or 'both/b' to enable the respective options) – default: \"none\"";
const latitudeRangeHelpMessageString = "**\"Latitude Range\"** (optional): The latitude bounds as \"(min, max)\" – default: \"(-90, 90)\"";
const longitudeRangeHelpMessageString = "**\"Longitude Range\"** (optional): The longitude bounds as \"(min, max)\" – default: \"(0, 360)\"";
const longitudeOffsetHelpMessageString = "**\"Longitude Offset\"** (optional): Offset for longitude values – default: \"0\"";
const unitOfMeasurementHelpMessageString = "**\"Unit Of Measurement\"** (optional): Unit system (\"Metric\"/\"Imperial\") – default: \"Metric\", can be adjusted in the plugin settings window";
const equatorialCircumferenceHelpMessageString = "**\"Equatorial Circumference\"** (optional): Custom equatorial circumference value – default: \"40075\" for Metric in kilometers, \"24901\" for Imperial in Miles";
const helpHelpMessageString = "**\"Help, -H, Info, Instruction, -I, or Usage\"**: You can also include a parameter with any of these keywords to display this message without an error prefix if you just want to show the usage instructions";

function allHelpMessages(settings: FantasyMapSettings) : string[] {
	return [
		mapHelpMessageString,
		mapIDsHelpMessageString,
		defaultZoomIncrementHelpMessageString.replace("default: \"1\"", `default: \"${settings.defaultZoomIncrement}\"`),
		defaultZoomLevelHelpMessageString,
/*		defaultLocationHelpMessageString,*/
		repeatHelpMessageString,
		latitudeRangeHelpMessageString,
		longitudeRangeHelpMessageString,
/*		longitudeOffsetHelpMessageString,*/
/*		unitOfMeasurementHelpMessageString.replace("default: \"Metric\"", `default: \"${settings.defaultUnitOfMeasurement}\"`),*/
/*		equatorialCircumferenceHelpMessageString,*/
		helpHelpMessageString
	];
}

// This string provides a template for users to copy and paste into their notes to create a new Fantasy-Map code block with all available parameters listed for easy reference
export const fantasyMapCodeBlockCopyToClipboardString = [
	"```Fantasy-Map",
	"Map:",
	"MapIDs:",
	"Default Zoom Increment:",
	"Default Zoom Level:",
/*	"Default Center:",*/
	"repeat:",
	"Latitude Range:",
	"Longitude Range:",
/*	"Longitude Offset:",*/
/*	"Unit Of Measurement:",*/
/*	"Equatorial Circumference:",*/
	"```"
].join("\n");

export const fantasyMapFrontMatterCopyToClipboardString = [
	"---",
	"fm-location: (lat, lng)", 
	"fm-id:",
	"fm-pin-icon:",
	"---"
].join("\n");

// Comprehensive list of affirmative values that will be interpreted as true for boolean parameters like "repeat"; this allows for a wide range of user inputs to enable the feature without requiring strict formatting
const affirmatives = [
	"yes", "y",
	"true", "t",
	"1",
	"on",
	"enable", "enabled",
	"ok", "okay",
	"sure",
	"yep", "yeah", "yea", "yup",
	"affirmative",
	"positive",
	"confirm", "confirmed"
];

const verticalrepeatAffirmatives = [
	"vertical", "vert", "ver", "vr", "v", "y"
];

const horizontalrepeatAffirmatives = [
	"horizontal", "hori", "hor", "hr", "h", "x"
]

const bothrepeatAffirmatives = [
	"both", "b"
]

// Comprehensive list of values that will be interpreted as Imperial units for the "unitOfMeasurement" parameter; any value that matches one of these (case-insensitive) will set the measurement system to Imperial, while any other value will default to Metric
const imperialUnits = [
	"imperial",
	"us customary"
];

// Comprehensive list of help keywords to trigger the usage instructions
const helpKeywords = [
	"help",
	"-h",
	"info",
	"instruction",
	"-i",
	"usage"
];

// This function parses the parameters from the code block content and returns an object with the corresponding values, applying defaults where necessary
export function parseFantasyMapParams(source: string, element: HTMLElement, ctx: MarkdownPostProcessorContext, component: Component, settings: FantasyMapSettings): FantasyMapParams {
	
	// split the code block content into lines, trim whitespace, and filter out any empty lines to prepare for parsing; this allows users to format their parameters with extra spaces or blank lines without affecting the parsing logic
	const lines = source.split("\n").map(l => l.trim()).filter(Boolean);
	const params: any = {};
	const helpMessages: string[] = [];

	// This function adds a help message to the helpMessages array if it hasn't already been added, and logs the added message to the console for debugging purposes; this ensures that each help message is only added once, even if multiple parameters contain help keywords
	function addHelpMessage(message: string) {
		if (!helpMessages.contains(message)) helpMessages.push(message);
	}
	
	// if there are no lines of content in the code block, display a help message with usage instructions to guide users on how to use the plugin and what parameters are available; this provides a helpful starting point for users who may be new to the plugin or unsure of how to format their parameters
	if (lines.length == 0) fantasyMapHelpMessage(element, ctx, component, compileHelpMessages(allHelpMessages(settings), "##### Available Fantasy Map Parameters:"), true);
	
	// iterate through each line of the code block content, parsing the key and value for each parameter and applying the appropriate logic based on the parameter type and expected format; if a help keyword is detected in the value of any parameter, the corresponding help message will be added to the helpMessages array and displayed to the user without an error prefix
	else for (const line of lines) {

		// if the line contains any help keywords, add the corresponding help message to the helpMessages array (if it hasn't already been added) and skip further processing for this line, allowing users to include a help keyword on its own line to get usage instructions without needing to trigger an error
		if (helpKeywords.includes(line)){
			allHelpMessages(settings).forEach(message => {addHelpMessage(message)});
			continue;
		}
		
		// if the line does not contain a colon, log a warning to the console and display an error message with usage instructions, but continue processing the remaining lines to allow users to correct formatting issues without losing all of their parameters; this also allows for more flexible formatting of the parameters in the code block, as users can include comments or other non-parameter lines without breaking the entire block
		if (!line.contains(":")){
			addHelpMessage(`<span class=\"fantasy-map-error\">Fantasy Map Error: Invalid parameter format: "${line}"! Each parameter should be in the format "key: value". Please check for typos and make sure you are using the correct format.</span>`);
			continue;
		}
		
		// split each line into a key and value based on the first colon, allowing for values that contain colons (e.g. file paths); if there is no colon or the value is empty, skip this line
		const [rawKey, ...rawValue] = line.split(":");
		if (!rawKey || rawValue.length === 0) continue;
		
		// trim whitespace from the key and value to ensure that extra spaces do not affect the parsing logic; this allows for more flexible formatting of the parameters in the code block
		const key = rawKey.trim().replace(/\s+/g, "").toLowerCase();
		const value = rawValue.join(":").trim();

		// This function checks if the value contains any help keywords, and if so, adds the corresponding help message to the helpMessages array (if it hasn't already been added) and returns true to indicate that a help message should be displayed; if the value does not contain any help keywords, it simply returns false
		function checkForHelp(message: string) : boolean {
			const helpRequested = helpKeywords.contains(value.toLowerCase());
			if (helpRequested) addHelpMessage(message);
			return helpRequested;
		}

		// if the value contains any help keywords, add the corresponding help message to the helpMessages array (if it hasn't already been added) and skip further processing for this parameter, allowing users to include a help keyword in any parameter to get usage instructions without needing to trigger an error
		if (helpKeywords.includes(key)){
			if (checkForHelp(helpHelpMessageString)) continue;
			allHelpMessages(settings).forEach(message => {addHelpMessage(message)});
			continue;
		}
		
		switch (key) {
			
			// set the name of the map to load
			case "map": 
				
				// help message for the map parameter if the value contains any help keywords
				if (checkForHelp(mapHelpMessageString)) break;
				
				if (value.trim().length == 0) addHelpMessage("Fantasy Map ERROR: map option is required!");
				
				// set the name of the map to load; supports relative paths, absolute paths, and bare filenames (e.g. "World Map.svg") - the file must be located somewhere in your vault - supported file types are SVG, PNG, JPG, JPEG, WEBP, and GIF
				params.map = value; 
				break;
				
			case "mapids":

				// help message for the mapIDs parameter if the value contains any help keywords
				if (checkForHelp(mapIDsHelpMessageString)) break;
				
				// break the value into a comma-separated list of IDs
				params.mapIDs = value.split(",").map(id => id.trim());
				break;
			
			case "pinsize":
				if (checkForHelp(pinSizeHelpMessageString)) break;

				const trimmed = value.trim();
				if (!isValidPinSize(trimmed)) addHelpMessage("Fantasy Map ERROR: Pin Size Value is invalid! Some examples of acceptable values are '24px', '5%'. This option utalizes css styles, specificaly the width property.")
				
				params.pinSize = value;
				break;
				
			// set the default zoom increment, defaulting to 1 if the value is not a valid number
			case "defaultzoomincrement": 
				
				// help message for the defaultZoomIncrement parameter if the value contains any help keywords
				if (checkForHelp(defaultZoomIncrementHelpMessageString.replace("default: \"1\"", `default: \"${settings.defaultZoomIncrement}\"`))) break;
				
				// if the value is not a valid number, default to 1
				params.defaultZoomIncrement = Number(value) || 1; 
				break;
				
			// set the default zoom level, defaulting to 1 if the value is not a valid number
			case "defaultzoomlevel": 
				
				// help message for the defaultZoomLevel parameter if the value contains any help keywords
				if (checkForHelp(defaultZoomLevelHelpMessageString)) break;
				
				//check value is a number and is greater than 0, otherwise default to 1
				params.defaultZoomLevel = Number(value) > 0 ? Number(value) : 1;
				break;
			
			// get the default center coordinates in the format (latitude, longitude), allowing for optional whitespace and decimal numbers; if the value is not in the correct format, it will be ignored and the default center will be (0, 0)
			case "defaultlocation":
				
				// help message for the defaultLocation parameter if the value contains any help keywords
				if (checkForHelp(defaultLocationHelpMessageString)) break;
				
				// get the default center coordinates in the format (latitude, longitude), allowing for optional whitespace and decimal numbers; if the value is not in the correct format, it will be ignored and the default center will be (0, 0)
				const defaultLocationRegMatch = value.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/);
				if (defaultLocationRegMatch) params.defaultLocation = [Number(defaultLocationRegMatch[1]), Number(defaultLocationRegMatch[2])];
				break;
				
			// set repeat to true if the value is an affirmative, false otherwise
			case "repeat": 
				
				// help message for the repeat parameter if the value contains any help keywords
				if (checkForHelp(repeatHelpMessageString)) break;
				
				// get the repeat method by cross checking which repeat option was provided
				params.repeat = (() => {

					// normalize the value provided and check which repeat option it matches with any repeating behavioural key words
					const normalizedValue = value.toLowerCase();

					// if the option provided was specifying for vertical repeating, set repeat to "repeat-y" to repeat the map vertically
					if (verticalrepeatAffirmatives.includes(normalizedValue)) 
						return "repeat-y";

					// if the option provided was a general affirmative or specifying for horizontal repeating, set repeat to "repeat-x" to repeat the map horizontally
					else if (affirmatives.includes(normalizedValue) || horizontalrepeatAffirmatives.includes(normalizedValue))
						return "repeat-x";
					
					// if the option provided was specifying for both horizontal and vertical repeating, set repeat to "repeat" to repeat the map in both directions;	
					else if (bothrepeatAffirmatives.includes(normalizedValue)) 
						return "repeat";

					// if none of these options were provided, default to "no-repeat" to not repeat the map	
					else return "no-repeat";
					
				})();
				
				break;
				
			// get latitude and longitude ranges in the format (min, max), allowing for optional whitespace and decimal numbers
			case "latituderange":
			case "longituderange":
				
				// help message for the LatitudeRange and LongitudeRange parameters if the value contains any help keywords
				if (checkForHelp(key == "latituderange" ? latitudeRangeHelpMessageString : longitudeRangeHelpMessageString)) break;
				
				// get latitude and longitude ranges in the format (min, max), allowing for optional whitespace and decimal numbers; if the value is not in the correct format, it will be ignored and the default range will be used (LatitudeRange: (-90, 90), LongitudeRange: (0, 360))
				const latitudeLongitudeRegMatch = value.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/);
				if (latitudeLongitudeRegMatch) params[key === "latituderange" ? "latituderange" : "longituderange"] = [Number(latitudeLongitudeRegMatch[1]), Number(latitudeLongitudeRegMatch[2])];
				break;
			
			// get the longitude offset, defaulting to 0 if the value is not a valid number (used for maps that have a different prime meridian other than the center of the map)
			case "longitudeoffset": 
				
				// help message for the LongitudeOffset parameter if the value contains any help keywords
				if (checkForHelp(longitudeOffsetHelpMessageString)) break;
				
				// get the longitude offset, defaulting to 0 if the value is not a valid number (used for maps that have a different prime meridian other than the center of the map)
				params.longitudeOffset = Number(value) || 0; 
				break;	
			
			// get the measurement units, defaulting to Metric if the value is not recognized as Imperial
			case "unitofmeasurement": 
				
				// help message for the UnitOfMeasurement parameter if the value contains any help keywords
				if (checkForHelp(unitOfMeasurementHelpMessageString.replace("default: \"Metric\"", `default: \"${settings.defaultUnitOfMeasurement}\"`))) break;
				
				// get the measurement units, defaulting to Metric if the value is not recognized as Imperial (e.g. "Imperial", "US Customary"); this will affect how distances and other measurements are displayed on the map
				params.measurementUnits = imperialUnits.contains(value.toLowerCase()) ? "Imperial" : "Metric"; 
				break;
			
			// get the equatorial length, allowing for values with commas (e.g. 40,075)
			case "equatorialcircumference":
				
				// help message for the equatorialCircumference parameter if the value contains any help keywords
				if (checkForHelp(equatorialCircumferenceHelpMessageString)) break;
				
				// get the equatorial length, allowing for values with commas (e.g. 40,075); if the value is not a valid number, it will default to 40,075 for Metric (in kilometers) or 24,901 for Imperial (in miles)
				const num = Number(value.replace(/,/g, ""));
				if (!isNaN(num)) params.equatorialCircumference = num;
				break;
			
			// if the key is not recognized, log a warning to the console but do not throw an error, allowing for flexibility in parameter formatting and the inclusion of additional parameters that may be used by other parts of the plugin or future updates
			default:
				console.warn(`Unknown Fantasy Map parameter: \"${rawKey}\"`);
				addHelpMessage(`Unknown parameter: "${rawKey}"! Please check for typos and make sure you are using the correct parameter names.`);
				break;
		}
	}

	// Defaults
	if (params.pinSize == null) params.pinSize = settings.defaultPinSize;
	if (params.defaultZoomIncrement == null) params.defaultZoomIncrement = settings.defaultZoomIncrement;
	if (params.defaultZoomLevel == null) params.defaultZoomLevel = 1;
	if (params.defaultLocation == null) params.defaultLocation = [0, 0];
	if (params.repeat == null) params.repeat = "no-repeat";
	if (params.latitudeRange == null) params.latitudeRange = [-90, 90];
	if (params.longitudeRange == null) params.longitudeRange = [0, 360];
	if (params.longitudeOffset == null) params.longitudeOffset = 0;
	if (params.unitOfMeasurement == null) params.unitOfMeasurement = settings.defaultUnitOfMeasurement;
	if (params.equatorialCircumference == null) params.equatorialCircumference = params.measurementUnits === "Metric" ? 40075 : 24901;
	
	if (helpMessages.length > 0) fantasyMapHelpMessage(element, ctx, component, compileHelpMessages(helpMessages, "##### Fantasy Map Help Messages:"), true);
	
	return params as FantasyMapParams;
}

function isValidPinSize(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;

	const el = document.createElement("div");
	el.style.width = "";
	el.style.width = trimmed;

	const result = el.style.width !== "";
	el.remove();
	return result;
}

// Render a help message to markdown
export async function fantasyMapHelpMessage(element: HTMLElement, ctx: MarkdownPostProcessorContext, component: Component, message: string | null, includeCopyLink: boolean = false) {
	
	if (message == null) return;
	
	// Render the markdown message in the code block container
	const container = element.createDiv();
	await MarkdownRenderer.renderMarkdown(message ?? "", container, ctx.sourcePath, component);
	if (includeCopyLink) appendCopyLink(container);
}

// This function appends a "Copy Fantasy-Map template" link to the provided container element, which when clicked will copy the predefined fantasyMapCopyToClipboardString to the user's clipboard and provide feedback by temporarily changing the link text to "Copied!" before reverting back to the original text after 1.5 seconds; this allows users to easily copy a template for creating new Fantasy-Map code blocks without needing to manually select and copy the text
export function appendCopyLink(container: HTMLElement) {
	const repeatper = container.createDiv({cls: "fantasy-map-copy-link"});
	const link = repeatper.createEl("a", {text: "Copy Fantasy-Map template", href: "#"});
	link.addEventListener("click", async (event) => {
		event.preventDefault();
		try {
			await navigator.clipboard.writeText(fantasyMapCodeBlockCopyToClipboardString);
			link.setText("Copied!");
			setTimeout(() => link.setText("Copy Fantasy-Map template"), 1500);
		} catch (err) {
			console.warn("Fantasy-Map copy failed", err);
		}
	});
}

export function compileHelpMessages(messages: string[], title: string) : string | null { 
	if (messages.length == 0) return null;
	
	const message = [title?? null];
	messages.forEach(m => {message.push("- {0}".replace("{0}", m))});
	return message.join("\n");
}
