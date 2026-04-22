import { App, Component, MarkdownRenderer } from "obsidian";
import type { Pin } from "./pinInteractions";

let currentPreview: HTMLElement | null = null;
let clearHoverDelay: (() => void) | null = null;

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

	const container = currentPreview;
	container.empty();

	const headerEl = container.createDiv({ cls: "fm-hover-header" });

	const titleLink = headerEl.createEl("a", {
		cls: "internal-link fm-hover-title",
		text: pin.note.basename,
	});

	titleLink.setAttr("href", pin.note.path);
	titleLink.dataset.href = app.metadataCache.fileToLinktext(
		pin.note,
		pin.note.path
	);

	titleLink.onclick = async (e) => {
		e.preventDefault();
		e.stopPropagation();
		await app.workspace.openLinkText(pin.note.path, pin.note.path, e.ctrlKey || e.metaKey);
	};

	const contentEl = container.createDiv({ cls: "fm-hover-content" });
	const fileText = await app.vault.read(pin.note);
	const body = stripFrontmatter(fileText);

	await MarkdownRenderer.render(app, body, contentEl, pin.note.path, component);
	wirePreviewLinks(contentEl, app, pin.note.path);

	const rect = pin.element.getBoundingClientRect();

	container.setCssStyles({
		position: "fixed",
		top: `${rect.bottom + 8}px`,
		left: `${rect.left}px`,
	});

	container.addClass("is-visible");
}

export function setPreviewTimeoutClearer(clearer: (() => void) | null): void {
	clearHoverDelay = clearer;
}

export function hideCustomPreview() {
	if (currentPreview) {
		currentPreview.removeClass("is-visible");
	}
}

export function destroyCustomPreview() {
	if (currentPreview) {
		currentPreview.remove();
		currentPreview = null;
	}
}

function stripFrontmatter(text: string): string {
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) {
			return text.slice(end + 4).trimStart();
		}
	}
	return text;
}

function attachPreviewHoverHandlers() {
	if (!currentPreview) return;

	currentPreview.onmouseenter = () => {
		clearHoverDelay?.();
	};

	currentPreview.onmouseleave = () => {
		hideCustomPreview();
	};
}

function wirePreviewLinks(
	container: HTMLElement,
	app: App,
	sourcePath: string
) {
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

			await app.workspace.openLinkText(linktext, sourcePath, e.ctrlKey || e.metaKey);
		};
	});

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
