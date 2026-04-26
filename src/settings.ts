import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import SimpleMap from "./main";
import {
	simpleMapCodeBlockCopyToClipboardString,
	simpleMapFrontMatterCopyToClipboardString,
	isValidPinSize,
} from "./paramaters";

// Define the settings interface for the simple map plugin
export interface SimpleMapSettings {
	defaultPinSize: string;
	defaultZoomIncrement: number;
}

// Set the default settings for the simple map plugin
export const DEFAULT_SETTINGS: SimpleMapSettings = {
	defaultPinSize: "24px",
	defaultZoomIncrement: 1,
};

export class SimpleMapSettingTab extends PluginSettingTab {
	plugin: SimpleMap;

	// Initialize the settings tab with a reference to the main plugin instance
	constructor(app: App, plugin: SimpleMap) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Create a setting for the default pin size with validation
		new Setting(containerEl)
			.setName("Default pin size")
			.setDesc(
				"Set the default size for pins on the map (e.g. 24px, 1.5rem, 5%)."
			)
			.addText((text) => {
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

		// Create a setting for the default zoom increment with validation
		new Setting(containerEl)
			.setName("Default zoom increment")
			.setDesc(
				"Set the default zoom increment for the map (e.g. 1 means each zoom step will increase/decrease the zoom level by 1)."
			)
			.addText((text) => {
				text
					.setPlaceholder("Enter a number (e.g. 1)")
					.setValue(this.plugin.settings.defaultZoomIncrement.toString())
					.onChange(async (value) => {
						const num = Number(value);

						if (!isNaN(num) && num > 0) {
							this.plugin.settings.defaultZoomIncrement = num;
							await this.plugin.saveSettings();
						} else {
							new Notice(
								"Please enter a valid positive number for the zoom increment."
							);
						}
					});
			});

		// Create a setting that provides a template code block for users to copy, with a button to copy it to the clipboard
		new Setting(containerEl)
			.setName("Template code block")
			.setDesc(
				"Copy this into a note to start a simple map block. Use 'help' or '-h' to get helpful messages and usage instructions."
			)
			.addTextArea((text) => {
				text.setValue(simpleMapCodeBlockCopyToClipboardString);
				text.setDisabled(true);
				text.inputEl.rows = 12;
				text.inputEl.setCssStyles({
					width: "100%",
					fontFamily: "var(--font-monospace)",
				});
			})
			.addButton((button) => {
				button.setButtonText("Copy").setCta().onClick(async () => {
					try {
						await navigator.clipboard.writeText(
							simpleMapCodeBlockCopyToClipboardString
						);
						new Notice("Simple map block copied");
					} catch (e) {
						console.error(e);
						new Notice("Failed to copy block");
					}
				});
			});

		// Create a setting that provides template note front matter for users to copy, with a button to copy it to the clipboard
		new Setting(containerEl)
			.setName("Template note front matter")
			.setDesc("Copy this into a note to pin a note to your map.")
			.addTextArea((text) => {
				text.setValue(simpleMapFrontMatterCopyToClipboardString);
				text.setDisabled(true);
				text.inputEl.rows = 11;
				text.inputEl.setCssStyles({
					width: "100%",
					fontFamily: "var(--font-monospace)",
				});
			})
			.addButton((button) => {
				button.setButtonText("Copy").setCta().onClick(async () => {
					try {
						await navigator.clipboard.writeText(
							simpleMapFrontMatterCopyToClipboardString
						);
						new Notice("Simple map front matter copied.");
					} catch (e) {
						console.error(e);
						new Notice("Failed to copy block.");
					}
				});
			});
	}
}
 
