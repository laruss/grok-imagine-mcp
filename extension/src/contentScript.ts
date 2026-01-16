import type { SendResponseCallback } from "./types";

console.log("content script loaded");

const SELECTORS = {
	INPUT: "div[contenteditable]",
	SUBMIT_BUTTON: "button[type=submit]",
	IMAGE_CONTAINER: "div[role=listitem]",
} as const;

const LOCAL_STORAGE_KEY = "useImagineModeStore";
const PENDING_REQUEST_KEY = "grokImaginePendingRequest";

interface ImagineModeStore {
	state: {
		aspectRatio: [number, number];
	} & Record<string, unknown>;
	version: number;
}

interface PendingRequest {
	prompt: string;
	aspectRatio?: string;
	timestamp: number;
}

// Message handler for both captureImage and automateGrokImagine
chrome.runtime.onMessage.addListener(
	(message, _, sendResponse: SendResponseCallback) => {
		if (message.action === "automateGrokImagine") {
			handleGrokAutomationRequest(message.prompt, message.aspectRatio)
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

// Handle automation request - checks if aspect ratio needs to be set via localStorage + reload
async function handleGrokAutomationRequest(
	prompt: string,
	aspectRatio?: string,
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
	debugLog(
		`[Grok] Received automation request with aspect ratio: ${aspectRatio || "default"}`,
	);

	// Check if we need to set aspect ratio via localStorage
	if (aspectRatio) {
		const currentAspectRatio = getCurrentAspectRatio();

		if (!currentAspectRatio) {
			throw new Error(
				"localStorage 'useImagineModeStore' not found. Please visit grok.com/imagine manually first to initialize settings, then try again.",
			);
		}

		const targetAspectRatio = parseAspectRatio(aspectRatio);
		const needsUpdate =
			currentAspectRatio[0] !== targetAspectRatio[0] ||
			currentAspectRatio[1] !== targetAspectRatio[1];

		if (needsUpdate) {
			debugLog(
				`[Grok] Aspect ratio needs update: [${currentAspectRatio}] -> [${targetAspectRatio}]`,
			);

			// Update localStorage
			const updated = setAspectRatioInLocalStorage(targetAspectRatio);
			if (!updated) {
				throw new Error(
					"Failed to update aspect ratio in localStorage. Please try again.",
				);
			}

			// Verify it was written
			const verifyAspectRatio = getCurrentAspectRatio();
			if (
				!verifyAspectRatio ||
				verifyAspectRatio[0] !== targetAspectRatio[0] ||
				verifyAspectRatio[1] !== targetAspectRatio[1]
			) {
				throw new Error(
					"Failed to verify aspect ratio update in localStorage. Please try again.",
				);
			}

			debugLog(
				"[Grok] Aspect ratio updated in localStorage, saving pending request and reloading...",
			);

			// Save the pending request to chrome.storage before reload
			await savePendingRequest(prompt, aspectRatio);

			// Reload the page - the content script will resume after reload
			location.reload();

			// This promise will never resolve because we're reloading
			// The continuation happens in checkAndResumePendingRequest()
			return new Promise(() => {});
		}

		debugLog(
			`[Grok] Aspect ratio already set to [${currentAspectRatio}], proceeding...`,
		);
	}

	// Aspect ratio is already correct or not specified, proceed directly
	return handleGrokAutomation(prompt, aspectRatio);
}

// Get current aspect ratio from localStorage
function getCurrentAspectRatio(): [number, number] | null {
	try {
		const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (!stored) {
			debugLog(`[Grok] localStorage key not found: ${LOCAL_STORAGE_KEY}`);
			return null;
		}

		const parsed: ImagineModeStore = JSON.parse(stored);
		if (
			!parsed.state?.aspectRatio ||
			!Array.isArray(parsed.state.aspectRatio)
		) {
			debugLog("[Grok] Invalid aspectRatio in localStorage");
			return null;
		}

		return parsed.state.aspectRatio;
	} catch (error) {
		debugLog(`[Grok] Error reading localStorage: ${error}`);
		return null;
	}
}

// Set aspect ratio in localStorage
function setAspectRatioInLocalStorage(aspectRatio: [number, number]): boolean {
	try {
		const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (!stored) {
			debugLog("[Grok] Cannot update localStorage - key not found");
			return false;
		}

		const parsed: ImagineModeStore = JSON.parse(stored);
		parsed.state.aspectRatio = aspectRatio;

		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
		debugLog(`[Grok] Updated localStorage aspectRatio to [${aspectRatio}]`);
		return true;
	} catch (error) {
		debugLog(`[Grok] Error updating localStorage: ${error}`);
		return false;
	}
}

// Save pending request to chrome.storage
async function savePendingRequest(
	prompt: string,
	aspectRatio?: string,
): Promise<void> {
	const pendingRequest: PendingRequest = {
		prompt,
		aspectRatio,
		timestamp: Date.now(),
	};

	await chrome.storage.local.set({ [PENDING_REQUEST_KEY]: pendingRequest });
	debugLog("[Grok] Saved pending request to chrome.storage");
}

// Check for and resume pending request after page reload
async function checkAndResumePendingRequest(): Promise<void> {
	try {
		const result = await chrome.storage.local.get(PENDING_REQUEST_KEY);
		const pendingRequest = result[PENDING_REQUEST_KEY] as
			| PendingRequest
			| undefined;

		if (!pendingRequest) {
			return;
		}

		// Check if request is still valid (within 60 seconds)
		const age = Date.now() - pendingRequest.timestamp;
		if (age > 60000) {
			debugLog("[Grok] Pending request expired, clearing...");
			await chrome.storage.local.remove(PENDING_REQUEST_KEY);
			return;
		}

		debugLog(
			`[Grok] Found pending request (age: ${Math.round(age / 1000)}s), resuming...`,
		);

		// Clear the pending request immediately to prevent re-execution
		await chrome.storage.local.remove(PENDING_REQUEST_KEY);

		// Wait for page to fully load
		await waitFor(1000);

		// Execute the automation
		const result2 = await handleGrokAutomation(
			pendingRequest.prompt,
			pendingRequest.aspectRatio,
		);

		// Send result back to background script
		debugLog(
			`[Grok] Pending request completed: ${result2.success ? "success" : "failed"}`,
		);

		// Notify background script of the result
		chrome.runtime.sendMessage({
			type: "pendingRequestComplete",
			result: result2,
		});
	} catch (error) {
		debugLog(`[Grok] Error resuming pending request: ${error}`);
		chrome.runtime.sendMessage({
			type: "pendingRequestComplete",
			result: {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

// Check for pending requests on page load
checkAndResumePendingRequest();

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

		// Phase 2: Aspect ratio is now handled via localStorage before page load
		// (see checkPendingRequest and setAspectRatioInLocalStorage functions)
		debugLog(
			`[Grok] Aspect ratio should already be set via localStorage: ${aspectRatio || "1:1"}`,
		);

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
		const TIMEOUT = 60000; // 30 seconds
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

// Helper function to convert aspect ratio string to array format
function parseAspectRatio(aspectRatio: string): [number, number] {
	switch (aspectRatio) {
		case "2:3":
			return [2, 3];
		case "3:2":
			return [3, 2];
		case "1:1":
			return [1, 1];
		case "9:16":
			return [9, 16];
		case "16:9":
			return [16, 9];
		default:
			debugLog(
				`[Grok] Unknown aspect ratio: ${aspectRatio}, defaulting to 1:1`,
			);
			return [1, 1];
	}
}
