import { App, PluginSettingTab, Setting } from "obsidian";
import FantasyMap from "./main";
import { fantasyMapCodeBlockCopyToClipboardString, fantasyMapFrontMatterCopyToClipboardString } from "./paramaters";

export interface FantasyMapSettings {
	defaultPinSize: string; // e.g. "24px", "1.5rem", "5%"
	defaultUnitOfMeasurement: string; // Metric or Imperial
	defaultZoomIncrement: number;
}

export const DEFAULT_SETTINGS: FantasyMapSettings = {
	defaultPinSize: "24px",
	defaultZoomIncrement: 1,
	defaultUnitOfMeasurement: "Metric"
}

// noinspection JSUnusedGlobalSymbols
export class FantasyMapSettingTab extends PluginSettingTab {
	plugin: FantasyMap;

	constructor(app: App, plugin: FantasyMap) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		
		/*new Setting(containerEl)
			.setName('Default Unit of Measurement')
			.setDesc('Choose the default unit of measurement for the map.')
			.addDropdown(dropdown =>
				dropdown
					.addOption("Metric", "Metric")
					.addOption("Imperial", "Imperial")
			.setValue(this.plugin.settings.defaultUnitOfMeasurement)
			.onChange(async (value) => {
				this.plugin.settings.defaultUnitOfMeasurement = value;
				await this.plugin.saveSettings();
			}));*/

		new Setting(containerEl)
			.setName("Default Pin Size")
			.setDesc("Set the default size for pins on the map (e.g. 24px, 1.5rem, 5%).")
			.addText(text => {
				text
					.setPlaceholder("Enter a size (e.g. 24px)")
					.setValue(this.plugin.settings.defaultPinSize)
					.onChange(async (value) => {
						const trimmed = value.trim();

						if (!isValidPinSize(trimmed)) {
							text.inputEl.addClass("is-invalid");
							text.inputEl.setAttribute(
								"title",
								"Enter a valid CSS size like 24px, 1.5rem, 5%, 10vw, or 0."
							);
							return;
						}

						text.inputEl.removeClass("is-invalid");
						text.inputEl.removeAttribute("title");

						this.plugin.settings.defaultPinSize = trimmed;
						await this.plugin.saveSettings();
					});
			});

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
		
		new Setting(containerEl)
			.setName('Default Zoom Increment')
			.setDesc('Set the default zoom increment for the map (e.g. 1 means each zoom step will increase/decrease the zoom level by 1).')
			.addText(text =>
				text
					.setPlaceholder('Enter a number (e.g. 1)')
					.setValue(this.plugin.settings.defaultZoomIncrement.toString())
					.onChange(async (value) => {
						const num = Number(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.defaultZoomIncrement = num;
							await this.plugin.saveSettings();
						} else {
							// @ts-ignore
							new Notice('Please enter a valid positive number for the zoom increment.');
						}
					}));
		
		new Setting(containerEl)
			.setName("Template code block")
			.setDesc("Copy this into a note to start a Fantasy-Map block.")
			.addTextArea(text => {
				text.setValue(fantasyMapCodeBlockCopyToClipboardString);
				text.setDisabled(true);
				text.inputEl.rows = 11; // adjust to fit your block
				text.inputEl.style.width = "100%";
				text.inputEl.style.fontFamily = "var(--font-monospace)";
			})
			.addButton(button => {
				button
					.setButtonText("Copy")
					.setCta()
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(fantasyMapCodeBlockCopyToClipboardString);
							// @ts-ignore
							new Notice("Fantasy-Map block copied");
						} catch (e) {
							console.error(e);
							// @ts-ignore
							new Notice("Failed to copy block");
						}
					});
			});

		new Setting(containerEl)
			.setName("Template Note Front Matter")
			.setDesc("Copy this into a note to pin a note to your map.")
			.addTextArea(text => {
				text.setValue(fantasyMapFrontMatterCopyToClipboardString);
				text.setDisabled(true);
				text.inputEl.rows = 11; // adjust to fit your block
				text.inputEl.style.width = "100%";
				text.inputEl.style.fontFamily = "var(--font-monospace)";
			})
			.addButton(button => {
				button
					.setButtonText("Copy")
					.setCta()
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(fantasyMapFrontMatterCopyToClipboardString);
							// @ts-ignore
							new Notice("Fantasy-Map block copied");
						} catch (e) {
							console.error(e);
							// @ts-ignore
							new Notice("Failed to copy block");
						}
					});
			});
	}
}
