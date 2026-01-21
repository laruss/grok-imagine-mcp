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
			// aspectRatio can be one of the following: "3:2", "2:3", "16:9", "9:16", "1:1"
			aspectRatio: z
				.enum(["3:2", "2:3", "16:9", "9:16", "1:1"])
				.default("1:1")
				.describe("The aspect ratio of the generated image."),
			imageCount: z
				.enum(["1", "2", "3", "4"])
				.default("1")
				.describe("The number of images to generate (1-4)."),
		},
	},
	async ({ prompt, aspectRatio, imageCount }) => {
		const count = Number.parseInt(imageCount || "1", 10);
		console.error(
			`[MCP] Received generate_image request: "${prompt}" [${aspectRatio || "1:1"}] x${count}`,
		);

		try {
			// Request image from Chrome extension via bridge
			const result = await imageBridge.requestImage(prompt, aspectRatio, count);

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

			// Save all images to disk
			const allFilePaths: string[] = [];
			const images = result.imageData!;
			for (let i = 0; i < images.length; i++) {
				const imageDataUrl = images[i]!;
				const filePaths = await saveImage({
					base64DataUrl: imageDataUrl,
					prompt,
					index: images.length > 1 ? i + 1 : undefined,
				});
				allFilePaths.push(...filePaths);
			}

			console.error(
				`[MCP] ${images.length} image(s) saved successfully to ${allFilePaths.length} location(s)`,
			);
			return {
				content: [
					{
						type: "text",
						text: `${images.length} image(s) saved to:\n${allFilePaths.map((p) => `- ${p}`).join("\n")}`,
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
