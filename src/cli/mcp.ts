/**
 * `mcp` subcommand handler.
 *
 * Starts a MCP (Model Context Protocol) stdio server so that AI agents
 * (Claude, OpenCode, Cursor, etc.) can invoke perfgraph tools directly.
 *
 * Usage:
 *   perfgraph mcp
 */

import { startMcpServer } from '../mcp/server.js';

const MCP_HELP = `
MCP OPTIONS
  No flags required. Starts a MCP stdio server that listens for
  JSON-RPC messages on stdin/stdout.

EXAMPLES
  perfgraph mcp

MCP CLIENT CONFIG
  {
    "mcpServers": {
      "perfgraph": {
        "command": "node",
        "args": ["dist/index.js", "mcp"]
      }
    }
  }
`;

/**
 * Parse CLI arguments for the mcp command and execute.
 */
export async function runMcpFromArgs(args: string[]): Promise<boolean> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(MCP_HELP);
    return true;
  }

  // Any unknown flags are an error
  for (const arg of args) {
    if (arg.startsWith('--')) {
      console.error(`Error: Unknown flag "${arg}"`);
      return false;
    }
  }

  try {
    await startMcpServer();
    return true;
  } catch (err) {
    console.error(`MCP server error: ${(err as Error).message}`);
    return false;
  }
}
