import type { SendResponseCallback } from "./types";

console.log("content script loaded");

const SELECTORS = {
	INPUT: "div[contenteditable]",
	SUBMIT_BUTTON: "button[type=submit]",
	IMAGE_CONTAINER: "div[role=listitem]",
	MODEL_SELECT_TRIGGER: "button#model-select-trigger",
	ASPECT_RATIO_2_3: "button[aria-label='2:3']",
	ASPECT_RATIO_3_2: "button[aria-label='3:2']",
	ASPECT_RATIO_1_1: "button[aria-label='1:1']",
	ASPECT_RATIO_9_16: "button[aria-label='9:16']",
	ASPECT_RATIO_16_9: "button[aria-label='16:9']",
} as const;

// Message handler for both captureImage and automateGrokImagine
chrome.runtime.onMessage.addListener(
	(message, _, sendResponse: SendResponseCallback) => {
		if (message.action === "automateGrokImagine") {
			handleGrokAutomation(message.prompt, message.aspectRatio)
				.then((result) => sendResponse(result))
				.catch((error) =>
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			return true; // Keep channel open for async
		}

		if (message.action === "captureImage") {
			const imageSelector = "img"; // Captures first image on the page
			const imgElement = document.querySelector(
				imageSelector,
			) as HTMLImageElement | null;

			if (!imgElement?.src) {
				sendResponse({
					success: false,
					error: "No image found on page",
				});
				return false;
			}

			// Fetch the image and convert to base64 data URL
			fetch(imgElement.src)
				.then((response) => {
					if (!response.ok) {
						throw new Error(`Failed to fetch image: ${response.status}`);
					}
					return response.blob();
				})
				.then((blob) => {
					// Convert blob to base64 data URL
					const reader = new FileReader();
					reader.onloadend = () => {
						const base64DataUrl = reader.result as string;
						sendResponse({
							success: true,
							imageUrl: base64DataUrl, // e.g., "data:image/png;base64,..."
						});
					};
					reader.onerror = () => {
						sendResponse({
							success: false,
							error: "Failed to convert image to base64",
						});
					};
					reader.readAsDataURL(blob);
				})
				.catch((error) => {
					console.error("Image capture error:", error);
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					});
				});

			return true; // Keep message channel open for async response
		}
		return false;
	},
);

// Grok Imagine automation handler
async function handleGrokAutomation(
	prompt: string,
	aspectRatio?: string,
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
	try {
		debugLog(`[Grok] Starting automation with prompt: ${prompt}`);

		// Phase 1: Find and fill prompt input
		const inputDiv = document.querySelector(SELECTORS.INPUT) as HTMLDivElement;
		if (!inputDiv) {
			throw new Error("Element not found: div[contenteditable]");
		}

		debugLog("[Grok] Found prompt input, entering text...");

		// Enter prompt
		inputDiv.focus();
		inputDiv.textContent = prompt;

		// Trigger input event for reactivity
		const inputEvent = new Event("input", { bubbles: true });
		inputDiv.dispatchEvent(inputEvent);

		// Wait a bit for UI to react
		await waitFor(500);

		// Phase 2: Select aspect ratio (if specified)
		if (aspectRatio && aspectRatio !== "1:1") {
			debugLog(`[Grok] Setting aspect ratio to: ${aspectRatio}`);

			try {
				// Click MODEL_SELECT_TRIGGER to open dropdown
				const modelSelectTrigger = document.querySelector(
					SELECTORS.MODEL_SELECT_TRIGGER,
				) as HTMLButtonElement;

				if (!modelSelectTrigger) {
					debugLog(
						"[Grok] Warning: Model select trigger not found, skipping aspect ratio selection",
					);
				} else {
					debugLog("[Grok] Clicking model select trigger...");
					modelSelectTrigger.click();

					// Wait for dropdown to appear
					await waitFor(300);

					// Click the appropriate aspect ratio button
					const aspectRatioSelector = getAspectRatioSelector(aspectRatio);
					const aspectRatioButton = document.querySelector(
						aspectRatioSelector,
					) as HTMLButtonElement;

					if (!aspectRatioButton) {
						debugLog(
							`[Grok] Warning: Aspect ratio button not found for ${aspectRatio}, continuing with default`,
						);
					} else {
						debugLog(`[Grok] Clicking aspect ratio button: ${aspectRatio}`);
						aspectRatioButton.click();

						// Wait for dropdown to close and UI to update
						await waitFor(300);
						debugLog("[Grok] Aspect ratio selected successfully");
					}
				}
			} catch (error) {
				debugLog(
					`[Grok] Error setting aspect ratio: ${error}, continuing with default`,
				);
			}
		} else {
			debugLog("[Grok] Using default aspect ratio (1:1)");
		}

		// Phase 3: Click submit button
		const submitButton = document.querySelector(
			SELECTORS.SUBMIT_BUTTON,
		) as HTMLButtonElement;
		if (!submitButton) {
			throw new Error("Element not found: button[type=submit]");
		}

		debugLog("[Grok] Clicking submit button...");
		submitButton.click();

		// Phase 4: Wait for image generation (30 second timeout)
		const startTime = Date.now();
		const TIMEOUT = 30000; // 30 seconds
		const POLL_INTERVAL = 5000; // 5 seconds
		const MIN_IMAGE_SIZE = 150000; // Minimum base64 string length for generated image
		let pollAttempt = 0;

		debugLog(
			"[Grok] Waiting for image generation (30s timeout, checking every 5s)...",
		);

		while (Date.now() - startTime < TIMEOUT) {
			pollAttempt++;
			const elapsed = Math.round((Date.now() - startTime) / 1000);

			// Wait 5 seconds before checking (except on first attempt)
			if (pollAttempt > 1) {
				await waitFor(POLL_INTERVAL);
			}

			// Check all list items
			const containers = document.querySelectorAll(SELECTORS.IMAGE_CONTAINER);

			debugLog(
				`[Grok] Poll attempt ${pollAttempt} (${elapsed}s elapsed): Found ${containers.length} containers`,
			);

			if (containers.length === 0) {
				debugLog("[Grok] No containers found yet, waiting...");
				continue;
			}

			// Check each container for generated image
			for (let i = 0; i < containers.length; i++) {
				const container = containers[i];
				const img = container.querySelector("img") as HTMLImageElement;

				if (!img || !img.src) {
					debugLog(`[Grok]   Container ${i + 1}: No image found`);
					continue;
				}

				const srcLength = img.src.length;
				debugLog(
					`[Grok]   Container ${i + 1}: Image src length = ${srcLength} chars`,
				);

				// Check if image src is long enough to be a generated image
				if (srcLength >= MIN_IMAGE_SIZE) {
					debugLog(
						`[Grok] ✓ Found generated image in container ${i + 1}! (${srcLength} chars)`,
					);

					// Image src should already be base64
					if (img.src.startsWith("data:image/")) {
						debugLog("[Grok] Image is base64, returning directly");
						return {
							success: true,
							imageUrl: img.src,
						};
					}

					// Otherwise fetch and convert
					debugLog("[Grok] Fetching and converting image to base64...");
					try {
						const response = await fetch(img.src);
						const blob = await response.blob();
						const base64 = await blobToBase64(blob);

						debugLog(
							`[Grok] ✓ Conversion complete! Image size: ${Math.round(blob.size / 1024)}KB`,
						);
						return {
							success: true,
							imageUrl: base64,
						};
					} catch (fetchError) {
						debugLog(
							`[Grok] Failed to fetch image: ${fetchError}, trying next container...`,
						);
					}
				} else {
					debugLog(
						`[Grok]   Container ${i + 1}: Image too small (${srcLength} < ${MIN_IMAGE_SIZE}), still generating`,
					);
				}
			}

			debugLog("[Grok] No generated images found yet, waiting 5 seconds...");
		}

		// Timeout reached
		throw new Error(
			"Image generation timed out after 30 seconds. Please check Grok service.",
		);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		debugLog(`[Grok] ERROR: ${errorMsg}`);
		throw error;
	}
}

// Helper function to send debug logs to background script
function debugLog(message: string) {
	console.log(message); // Also log to page console
	try {
		chrome.runtime.sendMessage({ type: "debug", message: message });
	} catch {
		// Ignore if background script isn't listening
	}
}

// Helper function to wait
function waitFor(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to convert blob to base64
function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

// Helper function to get the correct selector for aspect ratio
function getAspectRatioSelector(aspectRatio: string): string {
	switch (aspectRatio) {
		case "2:3":
			return SELECTORS.ASPECT_RATIO_2_3;
		case "3:2":
			return SELECTORS.ASPECT_RATIO_3_2;
		case "1:1":
			return SELECTORS.ASPECT_RATIO_1_1;
		case "9:16":
			return SELECTORS.ASPECT_RATIO_9_16;
		case "16:9":
			return SELECTORS.ASPECT_RATIO_16_9;
		default:
			debugLog(
				`[Grok] Unknown aspect ratio: ${aspectRatio}, defaulting to 1:1`,
			);
			return SELECTORS.ASPECT_RATIO_1_1;
	}
}
