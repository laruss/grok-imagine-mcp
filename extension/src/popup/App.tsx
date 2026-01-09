import { useEffect, useState } from "react";

type ConnectionStatus = "connected" | "disconnected" | "connecting";

export function App() {
	const [status, setStatus] = useState<ConnectionStatus>("disconnected");

	useEffect(() => {
		// Request status when popup opens
		chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
			if (response?.status) {
				setStatus(response.status);
			}
		});

		// Poll for status updates every 2 seconds
		const interval = setInterval(() => {
			chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
				if (response?.status) {
					setStatus(response.status);
				}
			});
		}, 2000);

		return () => clearInterval(interval);
	}, []);

	const getStatusColor = () => {
		switch (status) {
			case "connected":
				return "bg-green-500";
			case "connecting":
				return "bg-yellow-500";
			case "disconnected":
				return "bg-red-500";
		}
	};

	const getStatusText = () => {
		switch (status) {
			case "connected":
				return "Connected";
			case "connecting":
				return "Connecting...";
			case "disconnected":
				return "Disconnected";
		}
	};

	return (
		<div className="w-80 p-6">
			<h1 className="text-xl font-bold mb-4">Grok Imagine MCP</h1>

			<div className="flex items-center gap-3">
				<div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
				<span className="text-sm font-medium">{getStatusText()}</span>
			</div>

			{status === "connected" && (
				<p className="mt-4 text-sm text-gray-600">
					Extension is ready to generate images via MCP commands.
				</p>
			)}

			{status === "disconnected" && (
				<p className="mt-4 text-sm text-gray-600">
					Make sure the MCP server is running:{" "}
					<code className="bg-gray-100 px-1 rounded">bun run dev</code>
				</p>
			)}
		</div>
	);
}
