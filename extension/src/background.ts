// uncomment if you want options.html to be opened after extension is installed
/*
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({
      url: 'options.html',
    });
  }
});
*/

import type { ContentScriptResponseType } from "src/types.ts";

// Storage key for pending request (must match contentScript.ts)
const PENDING_REQUEST_KEY = "grokImaginePendingRequest";
// Storage key for tracking requestId during page reloads
const PENDING_REQUEST_ID_KEY = "grokImaginePendingRequestId";

// Alarm configuration
const KEEPALIVE_ALARM_NAME = "websocket-keepalive";
const KEEPALIVE_INTERVAL_MINUTES = 0.25; // 15 seconds

let ws: WebSocket | null = null;
let wsStatus: "connected" | "disconnected" | "connecting" = "disconnected";
let currentGrokTabId: number | undefined; // Track the current Grok tab for cleanup after page reload

// Start keepalive alarm when WebSocket connects
function startKeepalive() {
	chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
		periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
	});
	console.log("[Keepalive] Alarm started");
}

// Stop keepalive alarm when WebSocket disconnects
function stopKeepalive() {
	chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
	console.log("[Keepalive] Alarm stopped");
}

// Handle keepalive alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === KEEPALIVE_ALARM_NAME) {
		console.log("[Keepalive] Alarm triggered - checking WebSocket health");

		// Check if WebSocket is still connected
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			console.log("[Keepalive] WebSocket not connected, attempting reconnect");
			connectWebSocket();
		} else {
			console.log("[Keepalive] WebSocket is healthy");
		}
	}
});

function connectWebSocket() {
	if (ws && ws.readyState === WebSocket.OPEN) return;

	wsStatus = "connecting";
	ws = new WebSocket("ws://localhost:3000");

	ws.onopen = () => {
		console.log("WebSocket connected");
		wsStatus = "connected";
		startKeepalive();
	};

	ws.onmessage = (event) => {
		console.log("Message received:", event.data);

		try {
			// Parse message as JSON
			const data = JSON.parse(event.data);

			if (data.type === "requestImage") {
				console.log(
					"Received requestImage:",
					data.requestId,
					"aspectRatio:",
					data.aspectRatio || "1:1",
					"imageCount:",
					data.imageCount || 1,
				);
				captureAndSendImage(
					data.requestId,
					data.prompt,
					data.aspectRatio,
					data.imageCount,
				);
			} else {
				// Forward other messages to popup or content script if needed
				chrome.runtime.sendMessage({ type: "wsMessage", payload: data });
			}
		} catch (error) {
			console.error("Failed to parse WebSocket message:", error);
		}
	};

	ws.onclose = (event) => {
		console.log("WebSocket closed:", event.reason);
		wsStatus = "disconnected";
		stopKeepalive();
		// Reconnect logic if needed
		setTimeout(connectWebSocket, 5000);
	};

	ws.onerror = (error) => {
		console.error("WebSocket error:", error);
		wsStatus = "disconnected";
		stopKeepalive();
	};
}

async function captureAndSendImage(
	requestId: string,
	prompt: string,
	aspectRatio?: string,
	imageCount?: number,
) {
	let grokTabId: number | undefined;

	try {
		console.log(`[Grok] Starting automation for: "${prompt}"`);

		// Store the requestId and tabId in case we need to handle a page reload
		// This happens when aspect ratio needs to be changed via localStorage
		await chrome.storage.local.set({
			[PENDING_REQUEST_ID_KEY]: { requestId, timestamp: Date.now() },
		});

		// Create new tab with Grok Imagine
		const tab = await chrome.tabs.create({
			url: "https://grok.com/imagine",
			active: true, // Focus the tab to avoid throttling
		});

		grokTabId = tab.id;
		currentGrokTabId = grokTabId; // Store for later cleanup

		if (!grokTabId) {
			throw new Error("Failed to create Grok tab");
		}

		// Wait for tab to fully load
		await waitForTabComplete(grokTabId);

		// Wait a bit more for content script to initialize
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Send automation request to content script with retry
		const response = await sendMessageWithRetry(
			grokTabId,
			{
				action: "automateGrokImagine",
				prompt: prompt,
				aspectRatio: aspectRatio || "1:1",
				imageCount: imageCount || 1,
			},
			3,
		);

		// If we get here, the response was immediate (no page reload needed)
		// Clean up the pending request ID
		await chrome.storage.local.remove(PENDING_REQUEST_ID_KEY);
		currentGrokTabId = undefined;

		// Close the tab
		await chrome.tabs.remove(grokTabId);

		// Send response back to server
		if (
			response?.success &&
			response.imageUrls &&
			response.imageUrls.length > 0
		) {
			ws?.send(
				JSON.stringify({
					type: "imageResponse",
					requestId,
					success: true,
					imageData: response.imageUrls,
				}),
			);
			console.log(
				`[Grok] Success for request: ${requestId}, collected ${response.imageUrls.length} image(s)`,
			);
		} else {
			throw new Error(response?.error || "Unknown error from content script");
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Check if this is the "message channel closed" error from a page reload
		// In this case, the content script will resume and send results via pendingRequestComplete
		if (
			errorMessage.includes("message channel closed") ||
			errorMessage.includes("A listener indicated an asynchronous response")
		) {
			console.log(
				`[Grok] Page reload detected for request ${requestId}, waiting for content script to resume...`,
			);
			// Don't send error response - wait for pendingRequestComplete message
			return;
		}

		console.error(`[Grok] Error: ${errorMessage}`);

		// Clean up stored state
		await chrome.storage.local.remove(PENDING_REQUEST_ID_KEY);
		currentGrokTabId = undefined;

		// Try to close tab if it's still open
		if (grokTabId) {
			try {
				await chrome.tabs.remove(grokTabId);
			} catch {}
		}

		// Send error response
		ws?.send(
			JSON.stringify({
				type: "imageResponse",
				requestId,
				success: false,
				error: errorMessage,
			}),
		);
	}
}

// Helper function to wait for tab to complete loading
function waitForTabComplete(tabId: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			reject(new Error("Tab load timeout"));
		}, 30000); // 30 second timeout

		const listener = (
			updatedTabId: number,
			changeInfo: chrome.tabs.TabChangeInfo,
		) => {
			if (updatedTabId === tabId && changeInfo.status === "complete") {
				clearTimeout(timeout);
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		};

		chrome.tabs.onUpdated.addListener(listener);
	});
}

// Helper function to send message with retry (for content script initialization)
async function sendMessageWithRetry(
	tabId: number,
	message: unknown,
	maxRetries = 3,
): Promise<ContentScriptResponseType> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await chrome.tabs.sendMessage<unknown, ContentScriptResponseType>(
				tabId,
				message,
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// If it's a "Receiving end does not exist" error and we have retries left, wait and retry
			if (
				errorMessage.includes("Receiving end does not exist") &&
				attempt < maxRetries
			) {
				console.log(
					`[Grok] Content script not ready, retrying (${attempt}/${maxRetries})...`,
				);
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
				continue;
			}

			// Otherwise, throw the error
			throw error;
		}
	}

	throw new Error("Failed to send message after retries");
}

// Listen for debug messages from content scripts and status requests from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === "debug") {
		// Forward debug logs to service worker console
		console.log(`[Content Script] ${message.message}`);
	}

	if (message.type === "getStatus") {
		// Send current WebSocket status to popup
		sendResponse({ status: wsStatus });
	}

	// Handle results from content script after page reload (aspect ratio change)
	if (message.type === "pendingRequestComplete") {
		handlePendingRequestComplete(message.result, sender.tab?.id);
	}

	return true; // Keep channel open for async responses
});

// Handle the completion of a pending request after page reload
async function handlePendingRequestComplete(
	result: { success: boolean; imageUrls?: string[]; error?: string },
	tabId?: number,
) {
	try {
		// Get the stored requestId
		const stored = await chrome.storage.local.get(PENDING_REQUEST_ID_KEY);
		const pendingData = stored[PENDING_REQUEST_ID_KEY] as
			| { requestId: string; timestamp: number }
			| undefined;

		if (!pendingData) {
			console.error("[Grok] No pending requestId found for completed request");
			return;
		}

		const { requestId, timestamp } = pendingData;

		// Check if request is still valid (within 120 seconds - give extra time for generation)
		const age = Date.now() - timestamp;
		if (age > 120000) {
			console.error(
				`[Grok] Pending request ${requestId} expired (age: ${age}ms)`,
			);
			await chrome.storage.local.remove(PENDING_REQUEST_ID_KEY);
			return;
		}

		console.log(
			`[Grok] Received pendingRequestComplete for request ${requestId}`,
		);

		// Clean up stored state
		await chrome.storage.local.remove(PENDING_REQUEST_ID_KEY);

		// Close the tab
		const tabToClose = tabId || currentGrokTabId;
		if (tabToClose) {
			try {
				await chrome.tabs.remove(tabToClose);
			} catch {}
		}
		currentGrokTabId = undefined;

		// Send response back to server via WebSocket
		if (result.success && result.imageUrls && result.imageUrls.length > 0) {
			ws?.send(
				JSON.stringify({
					type: "imageResponse",
					requestId,
					success: true,
					imageData: result.imageUrls,
				}),
			);
			console.log(
				`[Grok] Success for request: ${requestId}, collected ${result.imageUrls.length} image(s) (after page reload)`,
			);
		} else {
			ws?.send(
				JSON.stringify({
					type: "imageResponse",
					requestId,
					success: false,
					error: result.error || "Unknown error from content script",
				}),
			);
			console.error(`[Grok] Error for request ${requestId}: ${result.error}`);
		}
	} catch (error) {
		console.error(`[Grok] Error handling pendingRequestComplete: ${error}`);
	}
}

// Call on extension load or event
connectWebSocket();

// Optional: Clean up on unload
chrome.runtime.onSuspend.addListener(() => {
	stopKeepalive();
	ws?.close();
});
