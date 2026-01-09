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

let ws: WebSocket | null = null;
let wsStatus: "connected" | "disconnected" | "connecting" = "disconnected";

function connectWebSocket() {
	if (ws && ws.readyState === WebSocket.OPEN) return;

	wsStatus = "connecting";
	ws = new WebSocket("ws://localhost:3000");

	ws.onopen = () => {
		console.log("WebSocket connected");
		wsStatus = "connected";
	};

	ws.onmessage = (event) => {
		console.log("Message received:", event.data);

		try {
			// Parse message as JSON
			const data = JSON.parse(event.data);

			if (data.type === "requestImage") {
				console.log("Received requestImage:", data.requestId);
				captureAndSendImage(data.requestId, data.prompt);
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
		// Reconnect logic if needed
		setTimeout(connectWebSocket, 5000);
	};

	ws.onerror = (error) => {
		console.error("WebSocket error:", error);
		wsStatus = "disconnected";
	};
}

async function captureAndSendImage(requestId: string, prompt: string) {
	let grokTabId: number | undefined;

	try {
		console.log(`[Grok] Starting automation for: "${prompt}"`);

		// Create new tab with Grok Imagine
		const tab = await chrome.tabs.create({
			url: "https://grok.com/imagine",
			active: false, // Don't focus the tab
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
	ws?.close();
});
