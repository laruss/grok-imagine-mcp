import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { imageBridge } from "./imageRequestBridge";
import { saveImage } from "./imageStorage";

const mcpServer = new McpServer({ name: "Grok Imagine", version: "1.0.0" });

mcpServer.registerTool(
	"generate_image",
	{
		description: "Generates an image based on a text prompt.",
		inputSchema: {
			prompt: z.string().describe("The text prompt for the image generation."),
			folderPath: z
				.string()
				.startsWith("/")
				.describe("Absolute path to the folder where the image will be saved."),
			// aspectRatio can be one of the following: "3:2", "2:3", "16:9", "9:16", "1:1"
			aspectRatio: z
				.enum(["3:2", "2:3", "16:9", "9:16", "1:1"])
				.default("1:1")
				.describe("The aspect ratio of the generated image."),
		},
	},
	async ({ prompt, folderPath, aspectRatio }) => {
		console.error(
			`[MCP] Received generate_image request: "${prompt}" [${aspectRatio || "1:1"}] -> ${folderPath}`,
		);

		try {
			// Request image from Chrome extension via bridge
			const result = await imageBridge.requestImage(
				prompt,
				folderPath,
				aspectRatio,
			);

			if (!result.success) {
				console.error(`[MCP] Image request failed: ${result.error}`);
				return {
					content: [
						{
							type: "text",
							text: `Error: ${result.error}`,
						},
					],
					isError: true,
				};
			}

			// Save image to disk
			const filePaths = await saveImage({
				base64DataUrl: result.imageData!,
				folderPath,
				prompt,
			});

			console.error(
				`[MCP] Image saved successfully to ${filePaths.length} locations`,
			);
			return {
				content: [
					{
						type: "text",
						text: `Image saved to:\n${filePaths.map((p) => `- ${p}`).join("\n")}`,
					},
				],
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`[MCP] Error handling generate_image: ${errorMessage}`);
			return {
				content: [
					{
						type: "text",
						text: `Error: ${errorMessage}`,
					},
				],
				isError: true,
			};
		}
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await mcpServer.connect(transport);
	console.error("MCP server is running on stdio");
}

main().catch((e) => {
	console.error(`Fatal error in main(): ${e.message}`);
	process.exit(1);
});
