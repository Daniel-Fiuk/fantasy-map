import { App, Component, MarkdownRenderer } from "obsidian";
import type { Pin } from "./pinInteractions";

// Module-level variable to hold the current preview element, if any.
let currentPreview: HTMLElement | null = null;
let clearHoverDelay: (() => void) | null = null;
let scheduleHoverHide: (() => void) | null = null;

// Displays a custom preview for a given pin, rendering the content of the associated note.
export async function showCustomPreview(
	pin: Pin,
	app: App,
	component: Component,
	event: MouseEvent | PointerEvent
) {
	if (!currentPreview) {
		currentPreview = document.body.createDiv({
			cls: "fantasy-map-hover-preview",
		});
		attachPreviewHoverHandlers();
	}

	// Clear any existing content in the preview container before rendering new content.
	const container = currentPreview;
	container.empty();

	// Create the header section of the preview, including the title and front matter location.
	const headerEl = container.createDiv({ cls: "fm-hover-header" });
	const titleLink = headerEl.createEl("a", {
		cls: "internal-link fm-hover-title",
		text: pin.note.basename,
	});

	// Retrieve the front matter from the note's cache to display additional information in the preview header.
	const cache = app.metadataCache.getFileCache(pin.note);
	const frontMatter = cache?.frontmatter;
	const frontMatterLocation = frontMatter
		? (frontMatter["fm-location"] as string)
		: "";

	// Create a sub-header element to display the location in the preview.
	const subHeaderEl = container.createDiv({ cls: "fm-hover-header" });
	subHeaderEl.createEl("code", {
		text: frontMatterLocation,
	});

	// Set up the title link to open the associated note when clicked, using Obsidian's workspace API.
	titleLink.setAttr("href", pin.note.path);
	titleLink.dataset.href = app.metadataCache.fileToLinktext(
		pin.note,
		pin.note.path
	);

	// Handle click events on the title link to open the note in Obsidian, respecting modifier keys for opening in new panes.
	titleLink.onclick = async (e) => {
		e.preventDefault();
		e.stopPropagation();
		await app.workspace.openLinkText(
			pin.note.path,
			pin.note.path,
			e.ctrlKey || e.metaKey
		);
	};

	// Render the content of the note associated with the pin into the preview container, stripping out any front matter for cleaner display.
	const contentEl = container.createDiv({ cls: "fm-hover-content" });
	const fileText = await app.vault.read(pin.note);
	const body = stripFrontmatter(fileText);

	// Use Obsidian's MarkdownRenderer to render the note content into the preview, ensuring that internal links are properly wired up for navigation.
	await MarkdownRenderer.render(app, body, contentEl, pin.note.path, component);
	wirePreviewLinks(contentEl, app, pin.note.path);

	// Position the preview container near the pin that triggered the event, using fixed positioning to ensure it stays in place relative to the viewport.
	const rect = pin.element.getBoundingClientRect();
	container.setCssStyles({
		position: "fixed",
		top: `${rect.bottom + 8}px`,
		left: `${rect.left}px`,
	});
	
	// Make the preview visible by adding the appropriate CSS class, allowing for any associated styles to take effect.
	container.addClass("is-visible");
}

// Allows external code to set a function that can clear any existing hover delay, preventing the preview from hiding prematurely when the user interacts with it.
export function setPreviewTimeoutClearer(clearer: (() => void) | null): void {
	clearHoverDelay = clearer;
}

// Allows external code to set a function that can schedule the hiding of the preview after a delay, enabling a smoother user experience when moving the mouse away from the preview.
export function setPreviewTimeoutScheduler(scheduler: (() => void) | null): void {
	scheduleHoverHide = scheduler;
}

// Hides the currently visible custom preview, if one exists, by removing the visibility class from the preview container.
export function hideCustomPreview() {
	if (currentPreview) {
		currentPreview.removeClass("is-visible");
	}
}

// Destroys the current preview element, if it exists, by removing it from the DOM and clearing the reference to it, allowing for cleanup when the preview is no longer needed.
export function destroyCustomPreview() {
	if (currentPreview) {
		currentPreview.remove();
		currentPreview = null;
	}
}

// Utility function to strip front matter from the note content, ensuring that only the main body of the note is rendered in the preview for a cleaner display.
function stripFrontmatter(text: string): string {
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) {
			return text.slice(end + 4).trimStart();
		}
	}

	return text;
}

// Attaches event handlers to the preview element to manage hover interactions, allowing the preview to remain visible when the user hovers over it and to hide when the user moves the mouse away.
function attachPreviewHoverHandlers() {
	if (!currentPreview) return;

	currentPreview.onmouseenter = () => {
		clearHoverDelay?.();
	};

	currentPreview.onmouseleave = () => {
		scheduleHoverHide?.();
	};
}

// Wires up internal and external links within the preview content to ensure that they function correctly, allowing users to navigate to linked notes or external URLs directly from the preview.
function wirePreviewLinks(
	container: HTMLElement,
	app: App,
	sourcePath: string
) {

	// Handle internal links by opening the linked note within Obsidian, respecting modifier keys for opening in new panes, and ensuring that users can easily navigate to related content from the preview.
	const internalLinks = container.querySelectorAll("a.internal-link");
	internalLinks.forEach((linkEl) => {
		const link = linkEl as HTMLAnchorElement;

		const linktext =
			link.dataset.href ||
			link.getAttribute("href") ||
			link.textContent?.trim();

		if (!linktext) return;

		link.onclick = async (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			await app.workspace.openLinkText(
				linktext,
				sourcePath,
				e.ctrlKey || e.metaKey
			);
		};
	});

	// Handle external links by opening them in a new browser tab, ensuring that users can access linked resources without leaving the Obsidian app.
	const externalLinks = container.querySelectorAll("a.external-link");
	externalLinks.forEach((linkEl) => {
		const link = linkEl as HTMLAnchorElement;
		const href = link.href;
		if (!href) return;

		link.onclick = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			window.open(href, "_blank", "noopener,noreferrer");
		};
	});
}
