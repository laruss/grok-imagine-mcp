import type { ServerWebSocket } from "bun";
import { imageBridge } from "./imageRequestBridge";

// Track connected WebSocket clients
const clients = new Set<ServerWebSocket>();

const server = Bun.serve({
	port: 3000,
	async fetch(req, server) {
		// upgrade the request to a WebSocket
		if (server.upgrade(req)) {
			return; // do not return a Response
		}
		return new Response("Upgrade failed", { status: 500 });
	},
	websocket: {
		message(_ws, message) {
			try {
				// Parse message as JSON
				const data = JSON.parse(message.toString());
				console.error(
					`[WebSocket] Received message type: ${data.type || "unknown"}`,
				);

				// Handle image response from extension
				if (data.type === "imageResponse") {
					imageBridge.handleImageResponse(data);
				} else {
					console.error(`[WebSocket] Unknown message type: ${data.type}`);
				}
			} catch (error) {
				console.error(`[WebSocket] Failed to parse message: ${error}`);
				// If not JSON, just log the raw message
				console.error(`[WebSocket] Raw message: ${message}`);
			}
		},

		open(ws) {
			// Add client to tracking set
			clients.add(ws);
			imageBridge.addWebSocketConnection(ws);
			console.error(
				`[WebSocket] Client connected. Total clients: ${clients.size}`,
			);
		},

		close(ws, code) {
			// Remove client from tracking set
			clients.delete(ws);
			imageBridge.removeWebSocketConnection(ws);
			console.error(
				`[WebSocket] Client disconnected (code: ${code}). Total clients: ${clients.size}`,
			);
		},
	},
});

console.error(`[WebSocket] Server listening on ${server.url}`);
