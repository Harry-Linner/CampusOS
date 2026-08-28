// Visual driver for CampusOS multi-window UI inspection.
//
// Connects to the dev Electron instance over CDP (enable by starting dev with
// CAMPUSOS_DEV_CDP_PORT=9223) and can list, screenshot, and operate EVERY
// window (main window, desk calendar overlay) independently — even while the
// window is occluded or on another monitor. Plugin iframes are no barrier:
// input goes through CDP as real DOM events.
//
// Usage (run from packages/core):
//   node scripts/visual.mjs list
//   node scripts/visual.mjs shot <url-substring> <out.png> [--front] [--full]
//   node scripts/visual.mjs shot-all <outdir>
//   node scripts/visual.mjs click <url-substring> <role> <name> [--nth=N] [--right] [--double]
//   node scripts/visual.mjs fill <url-substring> <role> <name> <value> [--nth=N]
//   node scripts/visual.mjs keys <url-substring> <key>            e.g. Escape, Enter
//   node scripts/visual.mjs eval <url-substring> "<js expression>"
//
// <url-substring> picks the window, e.g. "index.html" (main) or
// "desk-calendar.html" (desk calendar overlay).

import { chromium } from "playwright";

// Loopback must not go through a system proxy (Clash etc. returns 502 for it).
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[key];
}
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const port = process.env.CAMPUSOS_DEV_CDP_PORT ?? "9223";
const endpoint = `http://127.0.0.1:${port}`;

const [, , command, ...args] = process.argv;

const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value ?? true;
};
const positional = () => args.filter((a) => !a.startsWith("--"));

async function withBrowser(fn) {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("no browser context; is the dev app running with CAMPUSOS_DEV_CDP_PORT set?");
    return await fn(context.pages());
  } finally {
    await browser.close();
  }
}

function pick(pages, needle) {
  const page = pages.find((p) => p.url().includes(needle));
  if (!page) {
    const known = pages.map((p) => p.url()).join("\n  ");
    throw new Error(`no page matching "${needle}". Known pages:\n  ${known}`);
  }
  return page;
}

const shown = (url) => url.replace(/^https?:\/\/[^/]+/, "").slice(0, 80) || "/";

switch (command ?? "list") {
  case "list": {
    await withBrowser(async (pages) => {
      for (const [index, page] of pages.entries()) {
        console.log(`[${index}] ${shown(page.url())} — "${await page.title()}"`);
      }
    });
    break;
  }
  case "shot": {
    const [needle, out] = positional();
    await withBrowser(async (pages) => {
      const page = pick(pages, needle);
      if (flag("front")) await page.bringToFront();
      await page.screenshot({
        path: out,
        fullPage: Boolean(flag("full")),
        animations: "disabled"
      });
      console.log(`saved ${out} (${shown(page.url())})`);
    });
    break;
  }
  case "shot-all": {
    const [dir] = positional();
    await withBrowser(async (pages) => {
      for (const [index, page] of pages.entries()) {
        const name = page.url().split("/").pop()?.replace(/\.html.*$/, "") || `page-${index}`;
        const out = `${dir}/${name || "index"}-${index}.png`;
        await page.screenshot({ path: out, animations: "disabled" });
        console.log(`saved ${out}`);
      }
    });
    break;
  }
  case "click":
  case "fill":
  case "keys":
  case "eval": {
    const [needle, a, b, c] = positional();
    await withBrowser(async (pages) => {
      const page = pick(pages, needle);
      if (flag("front")) await page.bringToFront();
      const locator = page.getByRole(a, { name: b }).nth(Number(flag("nth") ?? 0));
      switch (command) {
        case "click": {
          if (flag("right")) await locator.click({ button: "right" });
          else if (flag("double")) await locator.dblclick();
          else await locator.click();
          console.log(`clicked ${a} "${b}" on ${shown(page.url())}`);
          break;
        }
        case "fill": {
          await locator.fill(c);
          console.log(`filled ${a} "${b}" = "${c}"`);
          break;
        }
        case "keys": {
          await page.keyboard.press(a);
          console.log(`pressed ${a}`);
          break;
        }
        case "eval": {
          console.log(String(await page.evaluate(a)));
          break;
        }
      }
    });
    break;
  }
  // Multi-step chains in ONE connection: popovers/menus die on disconnect, so
  // sequences that navigate menus must run atomically. JSON steps:
  //   {"click":["needle","role","name"]}          {"rightclick":["needle","role","name"]}
  //   {"doubleclick":["needle","role","name"]}    {"fill":["needle","role","name","value"]}
  //   {"keys":["needle","Escape"]}                {"eval":["needle","js"]}
  //   {"shot":["needle","out.png"]}               {"wait":[ms]}
  //   {"nth":n} applies to the preceding click/fill when present as a sibling key:
  //   {"click":["needle","role","name"],"nth":1}
  case "flow": {
    const [file] = positional();
    const steps = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8")));
    await withBrowser(async (pages) => {
      const page = (needle) => pick(pages, needle);
      for (const step of steps) {
        const [kind, value] = Object.entries(step)[0];
        const nth = typeof step.nth === "number" ? step.nth : 0;
        if (kind === "wait") {
          await new Promise((resolve) => setTimeout(resolve, value));
          continue;
        }
        const [needle, a, b, c] = value;
        const target = page(needle);
        if (kind === "shot") {
          await target.screenshot({ path: a, animations: "disabled" });
          console.log(`saved ${a}`);
        } else if (kind === "eval") {
          console.log(String(await target.evaluate(a)));
        } else if (kind === "keys") {
          await target.keyboard.press(a);
          console.log(`pressed ${a}`);
        } else if (kind === "fill") {
          await target.getByRole(a, { name: b }).nth(nth).fill(c);
          console.log(`filled ${a} "${b}"`);
        } else if (kind === "click" || kind === "rightclick" || kind === "doubleclick") {
          const locator = target.getByRole(a, { name: b }).nth(nth);
          if (kind === "rightclick") await locator.click({ button: "right" });
          else if (kind === "doubleclick") await locator.dblclick();
          else await locator.click();
          console.log(`${kind} ${a} "${b}"`);
        }
      }
    });
    break;
  }
  default:
    console.error(`unknown command "${command}"`);
    process.exitCode = 1;
}
