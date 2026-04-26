import {
	MarkdownPostProcessorContext,
	Component,
	Plugin,
	TFile,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	SimpleMapSettings,
	SimpleMapSettingTab,
} from "./settings";
import { parseSimpleMapParamaters, simpleMapHelpMessage } from "./paramaters";
import { createMapInteractionController } from "./mapInteractions";
import { createPinInteractionController } from "./pinInteractions";
import {
	destroyCustomPreview,
	setPreviewTimeoutClearer,
} from "./previewInteractions";

export default class SimpleMap extends Plugin {
	settings: SimpleMapSettings;

	// Load the plugin, initialize settings, and register the markdown code block processor
	async onload() {
		await this.loadSettings();

		this.addSettingTab(new SimpleMapSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor(
			"simple-map",
			this.main.bind(this)
		);
	}

	// Unload the plugin and clean up any resources or event listeners
	onunload() {
		destroyCustomPreview();
	}

	// Load settings from disk and merge with default settings
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SimpleMapSettings>
		);
	}

	// Save settings to disk
	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Main function to process the markdown code block and render the simple map
	async main(
		source: string,
		element: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		// Parse parameters from the code block and validate the map file
		const parameters = parseSimpleMapParamaters(
			this.app,
			source,
			element,
			ctx,
			this as Component,
			this.settings
		);

		// If the map parameter is missing or empty, display an error message and return
		if (parameters.map == null || parameters.map.trim() === "") return;

		// Attempt to find the map file in the vault using various methods
		const mapFile: TFile | null = (() => {

			// Normalize the map parameter by removing surrounding brackets and trimming whitespace
			const normalized = parameters.map.replace(/^\[\[|\]\]$/g, "").trim();

			// First, try to resolve the map parameter as a link relative to the source file
			const linked = this.app.metadataCache.getFirstLinkpathDest(
				normalized,
				ctx.sourcePath
			);

			// If the linked file exists and is a TFile, return it
			if (linked instanceof TFile) return linked;

			// Next, try to find the file by its path in the vault, and if that sucseeds, return the abstract file
			const abs = this.app.vault.getAbstractFileByPath(normalized);
			if (abs instanceof TFile) return abs;

			// Finally, as a fallback, search through all files in the vault for a file with a matching name, and return null if it fails to find one
			return this.app.vault.getFiles().find((f) => f.name === normalized) ?? null;
		})();

		// If the map file could not be found, display an error message and return
		if (!mapFile) {
			await simpleMapHelpMessage(
				this.app,
				element,
				`Simple Map Error: Map file "${parameters.map}" not found in vault! Double-check the file name and path, and make sure the file is located somewhere in your vault.`,
				false,
				ctx.sourcePath,
				this
			);
			return;
		}

		// Clear the container element and set up the structure for the simple map
		element.empty();
		element.addClass("sm-container");

		// Create a new Obsidian component to manage the lifecycle of the map and its interactions
		const renderComponent = new Component();
		(this as Component).addChild(renderComponent);

		// Create the main wrapper for the map, along with layers for the background and tiles, and a toolbar for controls
		const mapWrapper = element.createEl("div", { cls: "sm-wrapper" });
		const bgLayer = mapWrapper.createEl("div", { cls: "sm-background" });
		const tilesLayer = mapWrapper.createEl("div", { cls: "sm-tiles" });

		// Create a toolbar with buttons for zooming in, resetting the view, and zooming out, as well as an input for adjusting the zoom increment
		const toolbar = mapWrapper.createEl("div", { cls: "sm-toolbar" });
		toolbar.createEl("button", { cls: "sm-zoom-in", text: "+" });
		toolbar.createEl("button", { cls: "sm-reset", text: "Reset" });
		toolbar.createEl("button", { cls: "sm-zoom-out", text: "-" });

		// Create an input element for adjusting the zoom increment, and set its initial value based on the parameters or settings
		const zoomInput = toolbar.createEl("input", {
			cls: "sm-zoom-step",
			type: "number",
		});

		// Create the search field and its prediction dropdown. The dropdown lives inside the toolbar so it inherits the toolbar's hover/focus visibility behavior.
		const searchWrapper = toolbar.createEl("div", { cls: "sm-search" });
		const searchInput = searchWrapper.createEl("input", {
			cls: "sm-search-input",
			type: "text",
			attr: { placeholder: 'Search pins (use "quotes", && / and, || / or)' },
		});
		const searchSuggestions = searchWrapper.createEl("div", {
			cls: "sm-search-suggestions",
		});
		searchSuggestions.style.display = "none";

		// Set the initial value of the zoom increment input to either the value from the parameters or the default from settings
		zoomInput.value = String(
			parameters.defaultZoomIncrement ?? this.settings.defaultZoomIncrement
		);

		// Get the URL for the map file and set it as the background image for the background layer
		const mapUrl = this.app.vault.getResourcePath(mapFile);
		bgLayer.setCssStyles({
			backgroundImage: `url("${mapUrl}")`,
		});

		// Load the map image to determine its natural dimensions and calculate the appropriate height for the map wrapper based on its width and aspect ratio
		const mapImg = new Image();
		mapImg.src = mapUrl;

		// Once the map image has loaded, set up the map wrapper and background layer styles, create the tile elements for the map, and initialize the interaction controllers for both the map and the pins
		mapImg.onload = async () => {

			// Calculate the aspect ratio of the map image and set the height of the map wrapper accordingly to maintain the correct proportions
			const ratio = mapImg.naturalHeight / mapImg.naturalWidth;
			const wrapperWidth = mapWrapper.clientWidth;
			const baseHeight = wrapperWidth * ratio;

			// Set the height of the map wrapper based on the calculated height, and configure the background layer to repeat the map image and scale it to fit the height
			mapWrapper.setCssStyles({
				height: `${baseHeight}px`,
			});

			// Configure the background layer to repeat the map image and scale it to fit the height of the wrapper
			bgLayer.setCssStyles({
				backgroundRepeat: "repeat",
				backgroundSize: "auto 100%",
			});

			// Create a grid of tile elements to cover the map area, and set their background images to the map image, ensuring that they are positioned correctly to create a seamless tiled effect
			const tilesX = 3;
			const tilesY = 3;

			// Loop through the number of tiles in both the X and Y directions to create the individual tile elements
			for (let y = 0; y < tilesY; y++) {
				for (let x = 0; x < tilesX; x++) {
					const tile = tilesLayer.createEl("div", { cls: "sm-tile" });

					tile.setCssStyles({
						backgroundImage: `url("${mapUrl}")`,
						backgroundRepeat: "no-repeat",
						backgroundSize: "100% 100%",
					});

					tile.dataset.tileX = String(x);
					tile.dataset.tileY = String(y);
				}
			}

			// Position the tiles correctly based on their data attributes to ensure they create a seamless tiled background
			positionTiles(tilesLayer);

			// Initialize the interaction controllers for both the map and the pins, passing in the necessary parameters and callbacks to manage their behavior and interactions
			let mapController: ReturnType<typeof createMapInteractionController> | null = null;

			// Create the pin interaction controller, which will manage the behavior and interactions of the pins on the map, including hover previews and click actions
			const pinController = createPinInteractionController({
				app: this.app,
				component: renderComponent,
				wrapper: mapWrapper,
				parameters,
				ctx,
				setMapPanningEnabled: (enabled: boolean) => {
					mapController?.setPanningEnabled(enabled);
				},
			});

			// Initialize the pin controller to set up event listeners and prepare it for managing pin interactions on the map
			await pinController.init();
			setPreviewTimeoutClearer(() => pinController.clearHoverDelay());

			// Create the map interaction controller, which will manage the behavior and interactions of the map itself, including panning, zooming, and updating pin positions based on the current viewport
			mapController = createMapInteractionController({
				wrapper: mapWrapper,
				bgLayer,
				tilesLayer,
				toolbar,
				parameters,
				settings: this.settings,
				onViewportChanged: (offsetX, offsetY, tileWidth, tileHeight) => {
					pinController.updatePinPositions(
						offsetX,
						offsetY,
						tileWidth,
						tileHeight
					);
				},
				onInteractionStart: () => {
					destroyCustomPreview();
					pinController.clearHoverDelay();
				},
			});

			// Initialize the map controller to set up event listeners and prepare it for managing map interactions such as panning and zooming
			mapController.init();

			// Compute the dropdown's max width so it can grow past the input but never extend beyond the map container's right edge. Updated on every render so it tracks resizes.
			const updateDropdownMaxWidth = () => {
				const wrapperRect = mapWrapper.getBoundingClientRect();
				const searchRect = searchWrapper.getBoundingClientRect();
				// 8px buffer keeps the dropdown a hair inside the rounded container border.
				const available = Math.max(
					0,
					wrapperRect.right - searchRect.left - 8
				);
				searchWrapper.style.setProperty(
					"--sm-dropdown-max-width",
					`${available}px`
				);
			};

			// Wire up the toolbar search field. Filtering is recomputed each keystroke; suggestions are rebuilt from the same query and clicking one centers the map on that pin.
			const renderSuggestions = (query: string) => {
				searchSuggestions.empty();
				if (!query.trim()) {
					searchSuggestions.style.setCssProps({ display: "none" });
					return;
				}
				const items = pinController.getSuggestions(query, 8);
				if (items.length === 0) {
					searchSuggestions.style.setCssProps({ display: "none" });
					return;
				}
				updateDropdownMaxWidth();
				searchSuggestions.style.setCssProps({ display: "" });
				for (const item of items) {
					const row = searchSuggestions.createEl("div", {
						cls: "sm-search-suggestion",
					});
					row.createEl("span", {
						cls: "sm-search-suggestion-name",
						text: item.label,
					});
					// Skip the meta line when the match is on the note name itself; otherwise capitalize the property label for display.
					if (item.property !== "name") {
						const propLabel =
							item.property.charAt(0).toUpperCase() + item.property.slice(1);
						row.createEl("span", {
							cls: "sm-search-suggestion-meta",
							text: ` ${propLabel}: "${item.value}"`,
						});
					}
					row.addEventListener("mousedown", (e) => {
						e.preventDefault();
						searchInput.value = `"${item.value}"`;
						pinController.applySearch(searchInput.value);
						mapController?.centerOnLocation(
							item.pin.location.lat,
							item.pin.location.lng
						);
						searchSuggestions.empty();
						searchSuggestions.style.setCssProps({ display: "none" });
					});
				}
			};

			searchInput.addEventListener("input", () => {
				const q = searchInput.value;
				pinController.applySearch(q);
				renderSuggestions(q);
			});

			searchInput.addEventListener("focus", () => {
				renderSuggestions(searchInput.value);
			});

			searchInput.addEventListener("blur", () => {
				// Defer hiding so a click on a suggestion can fire its mousedown handler first.
				window.setTimeout(() => {
					searchSuggestions.style.setCssProps({ display: "none" });
				}, 150);
			});

			// Register a cleanup function to destroy the interaction controllers and clear any timeouts when the component is unloaded or re-rendered, ensuring that there are no lingering event listeners or resources being used
			renderComponent.register(() => {
				setPreviewTimeoutClearer(null);
				mapController?.destroy();
				pinController.destroy();
			});
		};

		// Helper function to position the tile elements based on their data attributes, ensuring that they are arranged in a grid to create a seamless tiled background effect
		function positionTiles(tilesLayerEl: HTMLElement) {

			// Get all the tile elements within the tiles layer and convert the NodeList to an array for easier manipulation
			const tiles = Array.from(tilesLayerEl.querySelectorAll(".sm-tile"));

			// Loop through each tile element and set its CSS styles for the left and top properties based on its data attributes, effectively positioning it in the correct location within the grid
			tiles.forEach((tile) => {
				const tileEl = tile as HTMLElement;
				tileEl.setCssStyles({
					left: `${Number(tileEl.dataset.tileX) * 100}%`,
					top: `${Number(tileEl.dataset.tileY) * 100}%`,
				});
			});
		}
	}
}
