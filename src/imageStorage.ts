import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface SaveImageOptions {
	base64DataUrl: string;
	prompt: string;
	index?: number; // Optional index for multiple images (1, 2, 3, etc.)
}

/**
 * Sanitize a string to be used as a filename
 * - Convert to lowercase
 * - Replace spaces with underscores
 * - Remove special characters
 * - Truncate to 50 characters
 */
function sanitizeFilename(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_-]/g, "")
		.substring(0, 50);
}

/**
 * Parse base64 data URL and extract format and data
 * Expected format: "data:image/png;base64,iVBORw0KGgo..."
 */
function parseDataUrl(dataUrl: string): {
	format: string;
	data: Buffer;
} {
	// Validate data URL format
	if (!dataUrl.startsWith("data:image/")) {
		throw new Error("Invalid data URL: must start with 'data:image/'");
	}

	// Extract MIME type and base64 data
	const matches = dataUrl.match(/^data:image\/([a-z]+);base64,(.+)$/i);
	if (!matches) {
		throw new Error(
			"Invalid data URL format: expected 'data:image/{format};base64,{data}'",
		);
	}

	const [, format, base64Data] = matches;

	// Decode base64 to buffer
	try {
		if (!base64Data || base64Data.length === 0)
			throw new Error("Invalid base64 data: empty string");
		if (!format) throw new Error("Invalid format: empty string");
		const data = Buffer.from(base64Data, "base64");
		return { format, data };
	} catch (error) {
		throw new Error(`Failed to decode base64 data: ${error}`);
	}
}

/**
 * Ensure directory exists, create if it doesn't
 */
async function ensureDirectory(dirPath: string): Promise<void> {
	try {
		await mkdir(dirPath, { recursive: true });
	} catch (error) {
		throw new Error(`Failed to create directory ${dirPath}: ${error}`);
	}
}

/**
 * Save image from base64 data URL to filesystem
 * Saves to system temp directory under grok-imagine/
 * Returns array of file paths where image was saved
 */
export async function saveImage(options: SaveImageOptions): Promise<string[]> {
	const { base64DataUrl, prompt, index } = options;

	// Parse data URL to extract format and binary data
	const { format, data } = parseDataUrl(base64DataUrl);

	// Generate filename with optional index suffix
	const sanitizedPrompt = sanitizeFilename(prompt) || "image";
	const timestamp = Date.now();
	const indexSuffix = index !== undefined ? `_${index}` : "";
	const filename = `${sanitizedPrompt}_${timestamp}${indexSuffix}.${format}`;

	// Prepare save location in system temp directory
	const tempDir = join(tmpdir(), "grok-imagine");
	const tempPath = join(tempDir, filename);

	// Ensure grok-imagine directory exists
	await ensureDirectory(tempDir);

	// Save to temp directory
	try {
		await Bun.write(tempPath, data);
		console.error(`[Storage] Saved image to temp: ${tempPath}`);
	} catch (error) {
		throw new Error(`Failed to save image to temp directory: ${error}`);
	}

	return [tempPath];
}

/**
 * Validate that a data URL is within size limits
 */
export function validateImageSize(
	base64DataUrl: string,
	maxSizeBytes = 10 * 1024 * 1024,
): boolean {
	// Estimate size from base64 length
	// Base64 encoding increases size by ~33%, so decode size ≈ encoded length * 0.75
	const estimatedSize = (base64DataUrl.length * 3) / 4;
	return estimatedSize <= maxSizeBytes;
}
