// noinspection JSUnusedGlobalSymbols

import { MarkdownPostProcessorContext, Component, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, FantasyMapSettings, FantasyMapSettingTab } from "./settings";
import { parseFantasyMapParams, fantasyMapHelpMessage } from "./paramaters";
import { initMapInteractions } from "./mapInteractions";
import { initPinInteractions } from "./pinInteractions";
import { destroyCustomPreview } from "./previewInteractions";

export default class FantasyMap extends Plugin {
	settings: FantasyMapSettings;
	
	//#region set up
	
	// called when the plugin is loaded
	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new FantasyMapSettingTab(this.app, this));
		
		this.registerMarkdownCodeBlockProcessor(
			"Fantasy-Map",
			this.main.bind(this)
		);
	}
	
	// called when the plugin is unloaded
	onunload() {
		destroyCustomPreview();
	}

	// This function loads the plugin settings
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<FantasyMapSettings>);
	}

	// This function saves the current plugin settings
	async saveSettings() {
		await this.saveData(this.settings);
	}
	//#endregion

	async main(source: string, element: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// get the user parameters set inside the defined code block in the note, and if the map parameter is not set or is empty, quit out of the function
		const parameters = parseFantasyMapParams(source, element, ctx, this as Component, this.settings);
		if (parameters.map == null || parameters.map.trim() === "") return;

		//#region get the map file

		// get the map file by searching for a TFile by linked path, absolute path, or filename in the vault
		const mapFile: TFile | null = (() => {

		// normalize the map paramater to remove any Obsidian link formatting (e.g. [[map.png]] -> map.png) and trim whitespace
			const normalized = parameters.map.replace(/^\[\[|$/g, "").trim();

		// return linked file if it's a TFile, which means the user provided a valid Obsidian link to the map file in the parameters
			const linked = this.app.metadataCache.getFirstLinkpathDest(normalized, ctx.sourcePath);
			if (linked instanceof TFile) return linked;

		// return absolute file if it's a TFile, which means the user provided a valid absolute path to the map file in the parameters
			const abs = this.app.vault.getAbstractFileByPath(normalized);
			if (abs instanceof TFile) return abs;

		// if neither linked nor absolute paths yield a TFile, search the vault for a file with a matching name. This allows users to simply provide the filename of the map without any path or link formatting, as long as the file exists somewhere in the vault.
			else return this.app.vault.getFiles().find(f => f.name === normalized) ?? null;
		})();

		// if we can't find the map file, display an error message and quit
		if (mapFile == null || !mapFile) {
			await fantasyMapHelpMessage(element, ctx, this, `Fantasy Map Error: Map file "${parameters.map}" not found in vault! Double-check the file name and path, and make sure the file is located somewhere in your vault.`, false);
			return;
		}

		//#endregion

		//#region create map

		// Clear the element and set up the container structure for the map and toolbar
		element.empty();
		element.addClass("fantasy-map-container");

		const mapWrapper = element.createEl("div", { cls: "fantasy-map-wrapper" });

		// background: seamless repeat to hide gaps
		const bgLayer = mapWrapper.createEl("div", { cls: "fantasy-map-background" });

		// foreground tiles: discrete high‑quality tiles
		const tilesLayer = mapWrapper.createEl("div", { cls: "fantasy-map-tiles" });

		// set image URL
		const mapUrl = this.app.vault.getResourcePath(mapFile);
		bgLayer.style.backgroundImage = `url("${mapUrl}")`;

		// load image to infer aspect and tile layout
		const mapImg = new Image();
		mapImg.src = mapUrl;
		mapImg.onload = async () => {
			const ratio = mapImg.naturalHeight / mapImg.naturalWidth;
			(mapWrapper as any)._mapAspectRatio = ratio;

			const wrapperWidth = mapWrapper.clientWidth;
			const baseHeight = wrapperWidth * ratio;

			// base height before zoom
			mapWrapper.style.height = `${baseHeight}px`;

			// background tiling (seamless)
			bgLayer.style.backgroundRepeat = "repeat"; // always repeat for gap hiding
			bgLayer.style.backgroundSize = "auto 100%"; // will be overridden by pan/zoom

			// create a small grid of tiles to cover viewport + margins
			const tilesX = 3; // center + one left + one right
			const tilesY = 3; // center + one up + one down

			for (let y = 0; y < tilesY; y++) {
				for (let x = 0; x < tilesX; x++) {
					const tile = tilesLayer.createEl("div", { cls: "fm-tile" });
					tile.style.backgroundImage = `url("${mapUrl}")`;
					tile.style.backgroundRepeat = "no-repeat";
					tile.style.backgroundSize = "100% 100%";
					tile.dataset.tileX = String(x);
					tile.dataset.tileY = String(y);
				}
			}

			positionTiles(tilesLayer);
			
			// pan/zoom now gets both layers
			initMapInteractions(this.app, mapWrapper, bgLayer, tilesLayer, toolbar, parameters, this.settings);

			// 
			await initPinInteractions(this.app, this, mapWrapper, parameters, this.settings, element, ctx);
		};

		// helper to place tiles in a grid
		function positionTiles(tilesLayer: HTMLElement) {
			const tiles = Array.from(tilesLayer.querySelectorAll<HTMLElement>(".fm-tile"));
			tiles.forEach(tile => {
				const tx = Number(tile.dataset.tileX);
				const ty = Number(tile.dataset.tileY);
				tile.style.left = `${tx * 100}%`;
				tile.style.top = `${ty * 100}%`;
			});
		}
		
		// Create a toolbar div to hold the zoom controls and zoom increment input
		const toolbar = mapWrapper.createEl("div", { cls: "fantasy-map-toolbar" });

		// Create zoom in, reset, and zoom out buttons
		toolbar.createEl("button", { cls: "fm-zoom-in", text: "+" });
		toolbar.createEl("button", { cls: "fm-reset", text: "Reset" });
		toolbar.createEl("button", { cls: "fm-zoom-out", text: "-" });

		// Create a zoom increment input field, pre-filled with the default zoom increment value from the parameters (or settings if not specified in the parameters)
		const zoomInput = toolbar.createEl("input", {
			cls: "fm-zoom-step",
			type: "number",
		});
		zoomInput.value = String(parameters.defaultZoomIncrement ?? this.settings.defaultZoomIncrement);
		//#endregion
	}
}
