// noinspection JSUnusedGlobalSymbols

import { MarkdownPostProcessorContext, Component, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, FantasyMapSettings, FantasyMapSettingTab } from "./settings";
import { parseFantasyMapParams, fantasyMapHelpMessage } from "./paramaters";
import { initMapInteractions } from "./mapInteractions";
import { initPinInteractions } from "./pinInteractions";
import { destroyCustomPreview } from "./previewInteractions";

export default class FantasyMap extends Plugin {
	settings: FantasyMapSettings;

	// called when the plugin is loaded
	async onload() {
		await this.loadSettings();

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

	// loads plugin settings
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<FantasyMapSettings>
		);
	}

	// saves plugin settings
	async saveSettings() {
		await this.saveData(this.settings);
	}

	async main(source: string, element: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const parameters = parseFantasyMapParams(
			this.app,
			source,
			element,
			ctx,
			this as Component,
			this.settings
		);

		if (parameters.map == null || parameters.map.trim() === "") return;

		const mapFile: TFile | null = (() => {
			const normalized = parameters.map.replace(/^\[\[|\]\]$/g, "").trim();

			const linked = this.app.metadataCache.getFirstLinkpathDest(normalized, ctx.sourcePath);
			if (linked instanceof TFile) return linked;

			const abs = this.app.vault.getAbstractFileByPath(normalized);
			if (abs instanceof TFile) return abs;

			return this.app.vault.getFiles().find((f) => f.name === normalized) ?? null;
		})();

		if (!mapFile) {
			await fantasyMapHelpMessage(
				element,
				ctx,
				this,
				`Fantasy Map Error: Map file "${parameters.map}" not found in vault! Double-check the file name and path, and make sure the file is located somewhere in your vault.`,
				false
			);
			return;
		}

		element.empty();
		element.addClass("fantasy-map-container");

		const mapWrapper = element.createEl("div", { cls: "fantasy-map-wrapper" });

		const bgLayer = mapWrapper.createEl("div", { cls: "fantasy-map-background" });
		const tilesLayer = mapWrapper.createEl("div", { cls: "fantasy-map-tiles" });

		const toolbar = mapWrapper.createEl("div", { cls: "fantasy-map-toolbar" });
		toolbar.createEl("button", { cls: "fm-zoom-in", text: "+" });
		toolbar.createEl("button", { cls: "fm-reset", text: "Reset" });
		toolbar.createEl("button", { cls: "fm-zoom-out", text: "-" });

		const zoomInput = toolbar.createEl("input", {
			cls: "fm-zoom-step",
			type: "number",
		});
		zoomInput.value = String(
			parameters.defaultZoomIncrement ?? this.settings.defaultZoomIncrement
		);

		const mapUrl = this.app.vault.getResourcePath(mapFile);
		bgLayer.setCssStyles({
			backgroundImage: `url("${mapUrl}")`,
		});

		const mapImg = new Image();
		mapImg.src = mapUrl;

		mapImg.onload = async () => {
			const ratio = mapImg.naturalHeight / mapImg.naturalWidth;

			const wrapperWidth = mapWrapper.clientWidth;
			const baseHeight = wrapperWidth * ratio;

			mapWrapper.setCssStyles({
				height: `${baseHeight}px`,
			});

			bgLayer.setCssStyles({
				backgroundRepeat: "repeat",
				backgroundSize: "auto 100%",
			});

			const tilesX = 3;
			const tilesY = 3;

			for (let y = 0; y < tilesY; y++) {
				for (let x = 0; x < tilesX; x++) {
					const tile = tilesLayer.createEl("div", { cls: "fm-tile" });

					tile.setCssStyles({
						backgroundImage: `url("${mapUrl}")`,
						backgroundRepeat: "no-repeat",
						backgroundSize: "100% 100%",
					});

					tile.dataset.tileX = String(x);
					tile.dataset.tileY = String(y);
				}
			}

			positionTiles(tilesLayer);

			initMapInteractions(
				this.app,
				mapWrapper,
				bgLayer,
				tilesLayer,
				toolbar,
				parameters,
				this.settings
			);

			await initPinInteractions(
				this.app,
				this,
				mapWrapper,
				parameters,
				element,
				ctx
			);
		};

		function positionTiles(tilesLayer: HTMLElement) {
			const tiles = Array.from(tilesLayer.querySelectorAll(".fm-tile"));

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
