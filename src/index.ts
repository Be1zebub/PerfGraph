#!/usr/bin/env node

/**
 * WebTrace CLI entry point.
 *
 * All command handlers are lazy-loaded so that `--help` stays fast —
 * Playwright, Lighthouse and other heavy deps only load when a
 * command is actually invoked.
 *
 * Usage:
 *   webtrace collect --url <url> [--output <dir>] [--runs <n>]
 *   webtrace normalize <input> [--output <file>] [--pretty]
 *   webtrace extract <ir-file> [--output <file>] [--pretty]
 *   webtrace analyze <features-file> [--output <file>] [--pretty]
 *   webtrace report <features-file> [--output <file>] [--pretty]
 *   webtrace run --url <url> [--output <dir>] [--runs <n>] [--pretty]
 *   webtrace mcp                              (MCP stdio server for AI agents)
 *   webtrace --help
 */

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`
WebTrace — Web Performance Diagnostic Tool

USAGE
  webtrace collect --url <url> [options]
  webtrace normalize <input> [--output <file>] [--pretty]
  webtrace extract <ir-file> [--output <file>] [--pretty]
  webtrace analyze <features-file> [--output <file>] [--pretty]
  webtrace report <features-file> [--output <file>] [--pretty]
  webtrace run --url <url> [options]             (full pipeline in one command)
  webtrace mcp                                   (MCP stdio server for AI agents)

COMMANDS
  collect    Collect performance data from a URL
  normalize  Normalize raw data into Intermediate Representation (IR)
  extract    Extract diagnostic features from IR bundle
  analyze    Build causal degradation graph from features
  report     Generate comprehensive JSON report for AI consumption
  run        Full pipeline: collect -> normalize -> extract -> analyze -> report
  mcp        Start MCP stdio server for AI agent integration

COLLECT OPTIONS
  --url <url>           Target URL to analyze (required)
  --output <dir>        Output directory (default: ./webtrace-output)
  --runs <n>            Number of collection runs (default: 1)
  --device <name>       Device name for mobile emulation (e.g. "iPhone 13")
  --no-lighthouse       Skip Lighthouse collection
  --no-coverage         Skip JS/CSS coverage collection
  --no-console          Skip console log collection
  --no-dom              Skip DOM snapshot collection
  --help, -h            Show this help message

NORMALIZE OPTIONS
  <input>               Path to a run directory OR parent output directory (positional, required)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

EXTRACT OPTIONS
  <file>                Path to a normalised IR JSON file (positional, required)
  --input, -i <file>    Path to IR JSON file (alternative to positional)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

ANALYZE OPTIONS
  <file>                Path to a FeatureSet JSON file (positional, required)
  --input, -i <file>    Path to FeatureSet JSON file (alternative to positional)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

REPORT OPTIONS
  <file>                Path to a FeatureSet JSON file (positional, required)
  --input, -i <file>    Path to FeatureSet JSON file (alternative to positional)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

RUN OPTIONS
  --url <url>           Target URL to analyze (required)
  --output <dir>        Output directory (default: ./webtrace-output)
  --runs <n>            Number of collection runs (default: 1)
  --pretty              Pretty-print final report JSON
  --device <name>       Device name for mobile emulation (e.g. "iPhone 13")
  --no-lighthouse       Skip Lighthouse collection
  --no-coverage         Skip JS/CSS coverage collection
  --no-console          Skip console log collection
  --no-dom              Skip DOM snapshot collection
  --help, -h            Show this help message

MCP OPTIONS
  No flags required. Starts an MCP stdio server.

EXAMPLES
  webtrace collect --url https://example.com
  webtrace collect --url https://example.com --output ./results
  webtrace collect --url https://example.com --runs 3
  webtrace collect --url https://example.com --no-lighthouse
  webtrace normalize ./runs/2025-01-15T10-30-00
  webtrace normalize ./runs/2025-01-15T10-30-00 --output ir.json
  webtrace normalize ./runs       (auto-detect latest run)
  webtrace extract ./ir.json
  webtrace extract ./ir.json --output features.toon --pretty
  webtrace analyze ./features.toon --output graph.toon --pretty
  webtrace report ./features.toon --output report.toon --pretty
  webtrace run --url https://example.com --pretty          (full pipeline)
  webtrace run --url https://example.com --pretty --runs 3
  webtrace mcp                                            (MCP server)
`);
}

async function main(): Promise<void> {
  const [subcommand] = args;

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if ((args.includes('--help') || args.includes('-h')) && subcommand !== 'normalize' && subcommand !== 'run' && subcommand !== 'mcp') {
    printHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'collect': {
      const { runCollect } = await import('./cli/collect.js');
      const result = await runCollect(args.slice(1));
      if (!result) process.exit(1);
      break;
    }

    case 'normalize': {
      const { runNormalizeFromArgs } = await import('./cli/normalize.js');
      const subArgs = args.slice(1);
      const isHelpRequest = subArgs.includes('--help') || subArgs.includes('-h');
      const result = await runNormalizeFromArgs(subArgs);
      if (!result) process.exit(isHelpRequest ? 0 : 1);
      break;
    }

    case 'extract': {
      const { runExtractFromArgs } = await import('./cli/extract.js');
      const result = await runExtractFromArgs(args.slice(1));
      if (!result) process.exit(1);
      break;
    }

    case 'analyze': {
      const { runAnalyzeFromArgs } = await import('./cli/analyze.js');
      const result = await runAnalyzeFromArgs(args.slice(1));
      if (!result) process.exit(1);
      break;
    }

    case 'report': {
      const { runReportFromArgs } = await import('./cli/report.js');
      const result = await runReportFromArgs(args.slice(1));
      if (!result) process.exit(1);
      break;
    }

    case 'run': {
      const { runRunFromArgs } = await import('./cli/run.js');
      const result = await runRunFromArgs(args.slice(1));
      if (!result) {
        process.exit(1);
      }
      break;
    }

    case 'mcp': {
      const { runMcpFromArgs } = await import('./cli/mcp.js');
      const ok = await runMcpFromArgs(args.slice(1));
      if (!ok) {
        process.exit(1);
      }
      break;
    }

    default: {
      console.error(`Unknown command: "${subcommand}"`);
      printHelp();
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
