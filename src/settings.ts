import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import FantasyMap from "./main";
import {
	fantasyMapCodeBlockCopyToClipboardString,
	fantasyMapFrontMatterCopyToClipboardString,
	isValidPinSize,
} from "./paramaters";

export interface FantasyMapSettings {
	defaultPinSize: string; // e.g. "24px", "1.5rem", "5%"
	defaultZoomIncrement: number; // e.g. 1 will increment zoom steps by 1, 2 by 2, and so on
}

export const DEFAULT_SETTINGS: FantasyMapSettings = {
	defaultPinSize: "24px",
	defaultZoomIncrement: 1,
};

export class FantasyMapSettingTab extends PluginSettingTab {
	plugin: FantasyMap;

	constructor(app: App, plugin: FantasyMap) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Default Pin Size
		new Setting(containerEl)
			.setName("Default Pin Size")
			.setDesc(
				"Set the default size for pins on the map (e.g. 24px, 1.5rem, 5%).",
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
								"Enter a valid CSS size like 24px, 1.5rem, 5%, 10vw, or 0.",
							);
							return;
						}

						text.inputEl.removeClass("is-invalid");
						text.inputEl.removeAttribute("title");

						this.plugin.settings.defaultPinSize = trimmed;
						await this.plugin.saveSettings();
					});
			});

		// Default Zoom Increment
		new Setting(containerEl)
			.setName("Default Zoom Increment")
			.setDesc(
				"Set the default zoom increment for the map (e.g. 1 means each zoom step will increase/decrease the zoom level by 1).",
			)
			.addText((text) =>
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
								"Please enter a valid positive number for the zoom increment.",
							);
						}
					}),
			);

		// Template code block
		new Setting(containerEl)
			.setName("Template code block")
			.setDesc("Copy this into a note to start a Fantasy-Map block. Use 'help' or '-h' to get helpfull messages and usage instructions.")
			.addTextArea((text) => {
				text.setValue(fantasyMapCodeBlockCopyToClipboardString);
				text.setDisabled(true);
				text.inputEl.rows = 11;
				text.inputEl.setCssStyles({
					width: "100%",
					fontFamily: "var(--font-monospace)",
				});
			})
			.addButton((button) => {
				button
					.setButtonText("Copy")
					.setCta()
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(
								fantasyMapCodeBlockCopyToClipboardString,
							);
							new Notice("Fantasy-Map block copied");
						} catch (e) {
							console.error(e);
							new Notice("Failed to copy block");
						}
					});
			});

		// Template Note Front Matter
		new Setting(containerEl)
			.setName("Template Note Front Matter")
			.setDesc("Copy this into a note to pin a note to your map.")
			.addTextArea((text) => {
				text.setValue(fantasyMapFrontMatterCopyToClipboardString);
				text.setDisabled(true);
				text.inputEl.rows = 11;
				text.inputEl.setCssStyles({
					width: "100%",
					fontFamily: "var(--font-monospace)",
				});
			})
			.addButton((button) => {
				button
					.setButtonText("Copy")
					.setCta()
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(
								fantasyMapFrontMatterCopyToClipboardString,
							);
							new Notice("Fantasy-Map block copied");
						} catch (e) {
							console.error(e);
							new Notice("Failed to copy block");
						}
					});
			});
	}
}
