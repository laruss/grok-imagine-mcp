import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

interface SaveImageOptions {
	base64DataUrl: string;
	folderPath: string;
	prompt: string;
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
 * Saves to both project root (for testing) and specified folder
 * Returns array of file paths where image was saved
 */
export async function saveImage(
	options: SaveImageOptions,
): Promise<string[]> {
	const { base64DataUrl, folderPath, prompt } = options;

	// Validate folder path is absolute
	if (!folderPath.startsWith("/")) {
		throw new Error(`Folder path must be absolute: ${folderPath}`);
	}

	// Parse data URL to extract format and binary data
	const { format, data } = parseDataUrl(base64DataUrl);

	// Generate filename
	const sanitizedPrompt = sanitizeFilename(prompt) || "image";
	const timestamp = Date.now();
	const filename = `${sanitizedPrompt}_${timestamp}.${format}`;

	// Prepare save locations
	const projectRoot = process.cwd();
	const rootPath = join(projectRoot, filename);
	const userPath = join(folderPath, filename);

	const savedPaths: string[] = [];

	// Save to project root (for testing)
	try {
		await Bun.write(rootPath, data);
		savedPaths.push(rootPath);
		console.error(`[Storage] Saved image to project root: ${rootPath}`);
	} catch (error) {
		throw new Error(`Failed to save image to project root: ${error}`);
	}

	// Save to user-specified folder
	try {
		// Ensure directory exists
		await ensureDirectory(dirname(userPath));

		await Bun.write(userPath, data);
		savedPaths.push(userPath);
		console.error(`[Storage] Saved image to user folder: ${userPath}`);
	} catch (error) {
		// If saving to user folder fails, we still have the root copy
		// Log error but don't throw
		console.error(`[Storage] Failed to save to user folder: ${error}`);
		// Still throw to indicate partial failure
		throw new Error(
			`Saved to project root but failed to save to ${folderPath}: ${error}`,
		);
	}

	return savedPaths;
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
