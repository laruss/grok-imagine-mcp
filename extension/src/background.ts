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

// Alarm configuration
const KEEPALIVE_ALARM_NAME = "websocket-keepalive";
const KEEPALIVE_INTERVAL_MINUTES = 0.25; // 15 seconds

let ws: WebSocket | null = null;
let wsStatus: "connected" | "disconnected" | "connecting" = "disconnected";

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
				);
				captureAndSendImage(data.requestId, data.prompt, data.aspectRatio);
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
) {
	let grokTabId: number | undefined;

	try {
		console.log(`[Grok] Starting automation for: "${prompt}"`);

		// Create new tab with Grok Imagine
		const tab = await chrome.tabs.create({
			url: "https://grok.com/imagine",
			active: true, // Focus the tab to avoid throttling
		});

		grokTabId = tab.id;

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
			},
			3,
		);

		// Close the tab
		await chrome.tabs.remove(grokTabId);

		// Send response back to server
		if (response?.success && response.imageUrl) {
			ws?.send(
				JSON.stringify({
					type: "imageResponse",
					requestId,
					success: true,
					imageData: response.imageUrl,
				}),
			);
			console.log(`[Grok] Success for request: ${requestId}`);
		} else {
			throw new Error(response?.error || "Unknown error from content script");
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`[Grok] Error: ${errorMessage}`);

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

	return true; // Keep channel open for async responses
});

// Call on extension load or event
connectWebSocket();

// Optional: Clean up on unload
chrome.runtime.onSuspend.addListener(() => {
	stopKeepalive();
	ws?.close();
});
