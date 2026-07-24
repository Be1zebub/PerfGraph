/**
 * CDP session manager.
 *
 * Launches a headless Chromium instance via Playwright and establishes a
 * raw CDP session for sending Chrome DevTools Protocol commands.
 */

import { createServer as createTcpServer } from 'net';
import { chromium, devices, type Browser, type BrowserContext, type Page, type CDPSession, type BrowserServer } from 'playwright';
import ow from 'ow';

/** The result of launching a browser and creating a CDP session */
export interface BrowserSession {
  /** The Playwright Browser instance */
  browser: Browser;
  /** The BrowserContext (isolated session) */
  context: BrowserContext;
  /** The Page that was opened */
  page: Page;
  /** Raw CDP session bound to the page */
  cdp: CDPSession;
  /** CDP debugging port for connecting external tools (e.g. Lighthouse) */
  cdpPort?: number;
  /** Browser server instance (when using launchServer) */
  browserServer?: BrowserServer;
}

/**
 * Launch a headless Chromium instance, create a new page, and establish a
 * raw CDP session.
 *
 * @param timeoutMs - Timeout for browser launch (default: 30_000)
 * @returns A BrowserSession with browser, context, page, and CDP session
 */
export async function launchBrowser(timeoutMs = 30_000): Promise<BrowserSession> {
  ow(timeoutMs, 'timeoutMs', ow.number.positive);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-networking',
    ],
    timeout: timeoutMs,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: false,
    });

    const page = await context.newPage();

    // Set a generous navigation timeout
    page.setDefaultNavigationTimeout(60_000);
    page.setDefaultTimeout(60_000);

    // Establish raw CDP session
    const cdp = await context.newCDPSession(page);

    return { browser, context, page, cdp };
  } catch (error) {
    // Clean up the browser if context/page creation fails
    await browser.close().catch(() => {});
    throw error;
  }
}

/**
 * Safely close a browser instance.
 * Logs but does not propagate any errors during cleanup.
 *
 * @param browser - The Browser instance to close
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  ow(browser, 'browser', ow.object);
  try {
    await browser.close();
  } catch (error) {
    console.error(`[session] Error closing browser: ${error}`);
  }
}

/**
 * Find a free TCP port on localhost.
 * Used to pick a port for Chrome's `--remote-debugging-port` flag.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        server.close(() => resolve(address.port));
      } else {
        server.close(() => reject(new Error('Could not determine free port')));
      }
    });
  });
}

/**
 * Launch a headless Chromium instance with an exposed CDP debugging port.
 *
 * Unlike the basic `launchBrowser()`, this starts Chrome with
 * `--remote-debugging-port` so external tools (e.g. Lighthouse) can
 * connect directly via the Chrome DevTools Protocol without going
 * through Playwright. Playwright itself still uses its normal pipe.
 *
 * @param timeoutMs - Timeout for browser launch (default: 30_000)
 * @param deviceName - Optional device name for emulation (e.g. "iPhone 13", "Pixel 7")
 * @returns A BrowserSession with cdpPort, browser, page, and CDP session
 */
export async function launchBrowserServer(timeoutMs = 30_000, deviceName?: string): Promise<BrowserSession> {
  ow(timeoutMs, 'timeoutMs', ow.number.positive);

  // Pick a free port for Chrome's CDP debugging server
  const cdpPort = await findFreePort();

  // Launch Chrome with --remote-debugging-port so Lighthouse can connect
  // via raw HTTP CDP (not just Playwright's internal pipe).
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-networking',
      `--remote-debugging-port=${cdpPort}`,
    ],
    timeout: timeoutMs,
  });

  try {
    let context: BrowserContext;

    if (deviceName && deviceName.length > 0) {
      const device = devices[deviceName];
      if (device) {
        context = await browser.newContext({
          ...device,
          ignoreHTTPSErrors: false,
        });
      } else {
        console.error(`[session] Unknown device "${deviceName}", falling back to desktop`);
        context = await browser.newContext({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          ignoreHTTPSErrors: false,
        });
      }
    } else {
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: false,
      });
    }

    const page = await context.newPage();

    page.setDefaultNavigationTimeout(60_000);
    page.setDefaultTimeout(60_000);

    const cdp = await context.newCDPSession(page);

    return { browser, context, page, cdp, cdpPort };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

/**
 * Safely close a BrowserServer and its underlying Chrome process.
 * Logs but does not propagate any errors during cleanup.
 *
 * @param browserServer - The BrowserServer to close
 */
export async function closeBrowserServer(browserServer: BrowserServer): Promise<void> {
  try {
    await browserServer.close();
  } catch (error) {
    console.error(`[session] Error closing browser server: ${error}`);
  }
}
