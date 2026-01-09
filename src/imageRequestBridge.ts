import { EventEmitter } from "node:events";
import type { ServerWebSocket } from "bun";

interface ImageRequest {
	requestId: string;
	prompt: string;
	folderPath: string;
	timestamp: number;
}

interface ImageResponse {
	type: "imageResponse";
	requestId: string;
	success: boolean;
	imageData?: string;
	error?: string;
}

interface ImageResult {
	success: boolean;
	imageData?: string;
	error?: string;
}

interface PendingRequest {
	resolve: (result: ImageResult) => void;
	reject: (error: Error) => void;
	timeout: Timer;
	prompt: string;
	folderPath: string;
}

class ImageRequestBridge extends EventEmitter {
	private pendingRequests: Map<string, PendingRequest> = new Map();
	private wsConnections: Set<ServerWebSocket> = new Set();
	private readonly REQUEST_TIMEOUT = Number.parseInt(
		process.env.IMAGE_REQUEST_TIMEOUT || "60000",
		10,
	);

	/**
	 * Register a WebSocket connection
	 */
	addWebSocketConnection(ws: ServerWebSocket): void {
		this.wsConnections.add(ws);
		console.error(
			`[Bridge] WebSocket connection added. Total connections: ${this.wsConnections.size}`,
		);
	}

	/**
	 * Unregister a WebSocket connection
	 */
	removeWebSocketConnection(ws: ServerWebSocket): void {
		this.wsConnections.delete(ws);
		console.error(
			`[Bridge] WebSocket connection removed. Total connections: ${this.wsConnections.size}`,
		);
	}

	/**
	 * Check if any WebSocket clients are connected
	 */
	hasConnectedClients(): boolean {
		return this.wsConnections.size > 0;
	}

	/**
	 * Send image request to all connected WebSocket clients
	 */
	private sendImageRequest(request: ImageRequest): void {
		const message = JSON.stringify({
			type: "requestImage",
			requestId: request.requestId,
			prompt: request.prompt,
			timestamp: request.timestamp,
		});

		for (const ws of this.wsConnections) {
			try {
				ws.send(message);
				console.error(
					`[Bridge] Sent requestImage to client: ${request.requestId}`,
				);
			} catch (error) {
				console.error(`[Bridge] Failed to send to client: ${error}`);
			}
		}
	}

	/**
	 * Request an image from the Chrome extension
	 * Called by MCP server
	 */
	async requestImage(prompt: string, folderPath: string): Promise<ImageResult> {
		// Check if any clients are connected
		if (!this.hasConnectedClients()) {
			throw new Error("No WebSocket clients connected");
		}

		// Generate unique request ID
		const requestId = crypto.randomUUID();
		const timestamp = Date.now();

		// Create promise that will be resolved when response arrives
		return new Promise<ImageResult>((resolve, reject) => {
			// Set up timeout
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(
					new Error(`Image request timed out after ${this.REQUEST_TIMEOUT}ms`),
				);
			}, this.REQUEST_TIMEOUT);

			// Store pending request
			this.pendingRequests.set(requestId, {
				resolve,
				reject,
				timeout,
				prompt,
				folderPath,
			});

			// Send request to WebSocket clients
			this.sendImageRequest({
				requestId,
				prompt,
				folderPath,
				timestamp,
			});

			console.error(
				`[Bridge] Image request created: ${requestId} (prompt: "${prompt}")`,
			);
		});
	}

	/**
	 * Handle image response from WebSocket client
	 * Called by WebSocket server
	 */
	handleImageResponse(response: ImageResponse): void {
		console.error(
			`[Bridge] Received image response: ${response.requestId} (success: ${response.success})`,
		);

		const pending = this.pendingRequests.get(response.requestId);

		if (!pending) {
			console.error(
				`[Bridge] No pending request found for: ${response.requestId}`,
			);
			return;
		}

		// Clear timeout
		clearTimeout(pending.timeout);

		// Remove from pending requests
		this.pendingRequests.delete(response.requestId);

		// Resolve or reject the promise
		if (response.success && response.imageData) {
			pending.resolve({
				success: true,
				imageData: response.imageData,
			});
		} else {
			pending.resolve({
				success: false,
				error: response.error || "Unknown error occurred",
			});
		}
	}

	/**
	 * Get the number of pending requests
	 */
	getPendingRequestCount(): number {
		return this.pendingRequests.size;
	}

	/**
	 * Clear all pending requests (useful for cleanup)
	 */
	clearPendingRequests(): void {
		for (const [_, pending] of this.pendingRequests.entries()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("Bridge shutting down"));
		}
		this.pendingRequests.clear();
	}
}

// Export singleton instance
export const imageBridge = new ImageRequestBridge();
