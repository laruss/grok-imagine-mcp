# Grok Image Generation MCP Server

An MCP (Model Context Protocol) server that generates images using Grok's Imagine feature through a Chrome extension
bridge. This allows AI assistants like Claude to generate images by automating the Grok Imagine interface.

## Architecture

This project consists of two main components:

### 1. MCP Server (`src/`)

- **MCP Server**: Exposes a `generate_image` tool via the Model Context Protocol (stdio)
- **WebSocket Server**: Runs on port 3000 to communicate with the Chrome extension
- **Image Bridge**: Manages request/response flow between MCP and the extension
- **Image Storage**: Saves generated images to OS temp directory (`{tmpdir}/grok-imagine/`)

### 2. Chrome Extension (`extension/`)

- **Background Script**: Connects to the WebSocket server at `ws://localhost:3000` with keepalive via Chrome alarms
- **Content Script**: Automates the Grok Imagine interface with localStorage-based aspect ratio control
- **Popup UI**: Shows connection status and extension information
- Built with React, TypeScript, and TailwindCSS

## How It Works

```
MCP Client (Claude)
    ↓
MCP Server (stdio)
    ↓
WebSocket Server (port 3000)
    ↓
Chrome Extension
    ↓
grok.com/imagine (automation)
    ↓
Chrome Extension (captures image)
    ↓
WebSocket Server
    ↓
MCP Server (saves to temp dir)
    |
MCP Client (receives file paths)
```

## Prerequisites

- [Bun](https://bun.sh) v1.3.5 or higher
- Chrome browser
- Grok account (access to grok.com/imagine)

## Installation

### 1. Install MCP Server Dependencies

```bash
bun install
```

### 2. Install Chrome Extension Dependencies

```bash
cd extension
bun install
```

### 3. Build the Chrome Extension

```bash
cd extension
bun run build
```

### 4. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the `extension/build` directory
5. The extension should now appear in your extensions list

## Usage

### Running the MCP Server

For development with hot reload:

```bash
bun run dev
```

For production:

```bash
bun run build
bun run build/index.js
```

### Using with Claude Desktop

Add this configuration to your Claude Desktop config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "grok-imagine": {
      "command": "bun",
      "args": [
        "/absolute/path/to/chrome-extension-mcp/build/index.js"
      ]
    }
  }
}
```

Replace `/absolute/path/to/chrome-extension-mcp` with the actual path to this project.

### Generating Images

Once configured, you can ask Claude to generate images:

```
Generate an image of a sunset over mountains
```

The `generate_image` tool supports the following parameters:

- `prompt` (required): Text description of the image to generate
- `aspectRatio` (optional): One of `"1:1"`, `"3:2"`, `"2:3"`, `"16:9"`, `"9:16"` (default: `"1:1"`)
- `imageCount` (optional): Number of images to generate, `"1"` to `"4"` (default: `"1"`)

Claude will use the `generate_image` tool, which will:

1. Send a request to the Chrome extension via WebSocket
2. The extension opens grok.com/imagine in a new tab
3. Sets the correct aspect ratio (reloads page if needed)
4. Automates entering the prompt and generating the image(s)
5. Captures the generated image(s) as base64
6. Closes the tab and sends the images back
7. The MCP server saves images to the OS temp directory (`{tmpdir}/grok-imagine/`)
8. Returns the file paths to the MCP client

## Development

### Project Structure

```
chrome-extension-mcp/
├── src/                          # MCP Server source code
│   ├── index.ts                  # Entry point
│   ├── mcpServer.ts              # MCP server with generate_image tool
│   ├── webServer.ts              # WebSocket server (port 3000)
│   ├── imageRequestBridge.ts     # Request/response management
│   └── imageStorage.ts           # Image saving logic (saves to temp dir)
├── extension/                    # Chrome Extension
│   ├── src/
│   │   ├── background.ts         # Background script (WebSocket client with keepalive)
│   │   ├── contentScript.ts      # Grok automation script
│   │   ├── types.ts              # Type definitions
│   │   ├── utils.ts              # Utility functions
│   │   ├── popup/                # Popup UI (React)
│   │   └── options/              # Options page (React)
│   ├── public/                   # Extension assets (manifest, HTML, icons)
│   ├── config/                   # Build scripts
│   └── build/                    # Built extension (load this in Chrome)
├── build/                        # Built MCP server
├── package.json                  # MCP server dependencies
└── tsconfig.json                 # TypeScript configuration
```

### Available Scripts

#### MCP Server (root directory)

```bash
bun run dev          # Run with hot reload
bun run build        # Build for production
bun run lint         # Lint code
bun run format       # Format code
bun run typecheck    # Type check
bun run fix          # Lint, format, and type check
```

#### Chrome Extension (extension directory)

```bash
bun run dev          # Development build with watch mode
bun run build        # Production build
bun run pack         # Package for Chrome Web Store
bun run lint         # Lint code
bun run format       # Format code
bun run typecheck    # Type check
bun run fix          # Lint, format, and type check
```

## Configuration

### Environment Variables

You can configure the MCP server behavior using environment variables:

- `IMAGE_REQUEST_TIMEOUT`: Timeout for image generation requests in milliseconds (default: 60000)

### Extension Settings

The Chrome extension connects to `ws://localhost:3000` by default. If you need to change this, modify
`extension/src/background.ts`.

## Troubleshooting

### Extension Not Connecting

1. Make sure the MCP server is running
2. Check that the WebSocket server is listening on port 3000
3. Look at the Chrome extension console (background script) for connection errors
4. Try disconnecting and reconnecting by reloading the extension

### Image Generation Fails

1. Ensure you're logged into grok.com in Chrome
2. Check that you have access to Grok Imagine
3. Look at the console logs in both the MCP server and Chrome extension
4. Verify that the content script is properly injecting into grok.com/imagine

### MCP Tool Not Appearing in Claude

1. Verify the config file path is correct
2. Restart Claude Desktop
3. Check the path to the built server is absolute
4. Look at Claude Desktop logs for errors

## License

This project is licensed under the MIT License - see the [extension/license](extension/license) file for details.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **MCP SDK**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Chrome Extension**: Manifest V3
- **Frontend**: React, TypeScript, TailwindCSS
- **Linting**: [BiomeJS](https://biomejs.dev/)
- **Communication**: WebSocket (native Bun.serve)

## Contributing

Contributions are welcome! Please ensure your code:

- Passes all linting and type checking (`bun run fix`)
- Follows the existing code style
- Includes appropriate error handling
- Updates documentation as needed
