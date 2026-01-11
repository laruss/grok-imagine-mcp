# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Extension MCP (Model Context Protocol) server that enables AI assistants to generate images using Grok's Imagine feature. The system bridges MCP stdio communication with a Chrome extension via WebSocket.

## Architecture

Multi-tier communication flow:
```
MCP Client (Claude Desktop)
  ↕ stdio
MCP Server (Bun process)
  ↕ WebSocket (localhost:3000)
Chrome Extension (Background Script)
  ↕ Chrome Messages API
Chrome Extension (Content Script)
  ↕ DOM Automation
grok.com/imagine
```

**Key Components:**

1. **MCP Server** (`src/mcpServer.ts`): Exposes `generate_image` tool via stdio, accepts prompt + folderPath + aspectRatio
2. **WebSocket Server** (`src/webServer.ts`): Runs on port 3000 using Bun's native WebSocket support
3. **Image Request Bridge** (`src/imageRequestBridge.ts`): UUID-based request/response coordination with EventEmitter pattern, 60s timeout
4. **Image Storage** (`src/imageStorage.ts`): Saves base64 images to disk, sanitizes filenames from prompts
5. **Chrome Extension Background** (`extension/src/background.ts`): WebSocket client, orchestrates tab automation with retry logic
6. **Chrome Extension Content Script** (`extension/src/contentScript.ts`): DOM automation on grok.com/imagine with polling

## Commands

### MCP Server (root directory)

```bash
bun run dev          # Hot reload during development
bun run build        # Bundle to build/index.js for production
bun run fix          # Lint, format, and typecheck (use before commits)
```

To run the built server:
```bash
bun run build/index.js
```

### Chrome Extension (extension/ directory)

```bash
cd extension
bun run dev          # Watch mode, rebuilds on changes
bun run build        # Production build to extension/build/
bun run pack         # Package for Chrome Web Store
bun run fix          # Lint, format, and typecheck
```

After building, load `extension/build/` as an unpacked extension in Chrome.

## Development Workflow

1. **Two-part development**: MCP server and Chrome extension are developed separately
2. **Install dependencies in both places**:
   ```bash
   bun install              # Root for MCP server
   cd extension && bun install  # For extension
   ```
3. **Extension rebuild required**: After changing extension code, run `bun run build` in `extension/` and reload the extension in Chrome
4. **MCP server restart required**: After changing MCP server code, restart the server (or use `bun run dev` for hot reload)

## Bun-Specific Patterns

This project uses Bun's native APIs:

- **WebSocket**: `Bun.serve()` with `websocket` handlers (no `ws` package)
- **File I/O**: `Bun.write()` and `Bun.file()` instead of `node:fs`
- **Bundling**: `bun build` for both MCP server and extension
- **Environment**: Bun automatically loads `.env` files

Do NOT use: `express`, `ws`, `better-sqlite3`, `ioredis`, `pg`, `dotenv`

## Extension Build System

Custom build script at `extension/config/build.ts`:
- Bundles TypeScript/React to browser JS
- Processes CSS with PostCSS + Tailwind
- Copies HTML from `public/` to `build/`
- Entry points: `background.ts`, `contentScript.ts`, `popup/index.tsx`, `options/index.tsx`

## Code Quality

**BiomeJS** handles both linting and formatting (replaces ESLint + Prettier):
- Separate configs for root and extension/
- Tab indentation, double quotes
- Always run `bun run fix` before commits

**Lefthook Git Hooks** (extension only):
- Pre-commit: Auto-formats staged files with Biome
- Pre-push: Runs full build to catch errors

## Important Patterns

1. **Request/Response Flow**: UUID-based tracking with Promise + timeout, cleanup on completion/error
2. **Error Propagation**: Multi-layer logging with prefixes ([MCP], [WebSocket], [Bridge], [Grok])
3. **Retry Mechanisms**:
   - WebSocket auto-reconnect (5s delay)
   - Content script initialization retry (3 attempts, 1s delay)
   - Image polling (30s timeout, 5s intervals)
4. **Dual Save**: Images saved to both project root (testing) and user-specified folder

## Configuration

**Environment Variables** (optional):
- `IMAGE_REQUEST_TIMEOUT`: Override 60s default for image generation

**Claude Desktop Integration**:
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "grok-imagine": {
      "command": "bun",
      "args": ["/absolute/path/to/chrome-extension-mcp/build/index.js"]
    }
  }
}
```

## Testing Prerequisites

- Bun v1.3.5+
- Chrome browser with extension loaded
- Active Grok account with access to grok.com/imagine
- User must be logged into Grok in Chrome

## Known Limitations

- Aspect ratio parameter defined in MCP but not wired to content script
- Content script injected globally (`<all_urls>`), could be optimized to grok.com only
- No state persistence across extension restarts