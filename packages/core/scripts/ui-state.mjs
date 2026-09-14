// Captures and compares the rendered state of both CampusOS windows.
//
//   node scripts/ui-state.mjs collect <out.json>
//   node scripts/ui-state.mjs compare <before.json> <after.json>
//
// A CSS change that is supposed to be inert - deleting dead rules, moving a block into
// another stylesheet - cannot be checked with the build hash, because the bundle is
// meant to change. This is the replacement: `collect` walks the main window's views and
// the desk calendar in one dev session and records, per view, the set of class names in
// the DOM and a computed-style fingerprint per element; `compare` then reports which
// class names appeared or disappeared and which elements changed.
//
// Run it against the same dev session before and after the change (start dev with
// CAMPUSOS_DEV_CDP_PORT=9223). Some views load their data asynchronously and are not
// deterministic - run `collect` twice before the change to learn which ones, and only
// treat a difference as a regression when it exceeds that noise. See
// docs/specs/refactor-tax-program.md.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[key];
}
process.env.NO_PROXY = "127.0.0.1,localhost";

const VIEWS = ["总览", "学业", "日程", "AI 助手", "资料", "校园资讯", "扩展", "设置"];

const PROJECTION = () => {
  const fnv = (text) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  const rows = [];
  for (const element of document.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    const declarations = [];
    for (const name of style) declarations.push(`${name}:${style.getPropertyValue(name)}`);
    const selector = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList]
      .map((name) => `.${name}`)
      .join("")}`;
    rows.push({ selector, hash: fnv(declarations.join(";")) });
  }
  return { url: location.pathname, elements: rows.length, hash: fnv(rows.map((row) => `${row.selector}|${row.hash}`).join("\n")), rows };
};

const CLASSES = () => [...new Set([...document.querySelectorAll("*")].flatMap((element) => [...element.classList]))].sort();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(out) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CAMPUSOS_DEV_CDP_PORT ?? "9223"}`);
  const pages = browser.contexts()[0].pages();
  // The desk calendar shares the dev origin, so identify the main window by exclusion.
  const main = pages.find((page) => !page.url().includes("desk-calendar"));
  if (!main) throw new Error(`main window not found: ${pages.map((page) => page.url()).join(", ")}`);

  const mainClasses = new Set();
  const views = {};
  for (const view of VIEWS) {
    await main.getByRole("button", { name: view }).first().click();
    await wait(3200);
    for (const name of await main.evaluate(CLASSES)) mainClasses.add(name);
    views[view] = await main.evaluate(PROJECTION);
  }

  // Open the desk calendar through the schedule view's real toggle; if an earlier capture
  // left it open, reuse the window so repeat captures see the same state.
  await main.getByRole("button", { name: "日程" }).first().click();
  await wait(1500);
  const findDesk = () => browser.contexts()[0].pages().find((page) => page.url().includes("desk-calendar"));
  if (!findDesk()) {
    await main.getByRole("button", { name: /打开桌面日历/ }).first().click();
    await wait(5000);
  }
  const desk = findDesk();
  const deskState = desk ? { classes: await desk.evaluate(CLASSES), projection: await desk.evaluate(PROJECTION) } : null;
  writeFileSync(out, `${JSON.stringify({ mainClasses: [...mainClasses].sort(), views, desk: deskState }, null, 2)}\n`);
  console.log(
    `saved ${out}: ${mainClasses.size} classes in the main window, ${deskState ? `${deskState.classes.length} in the desk calendar` : "no desk calendar window"}`
  );
  for (const [view, projection] of Object.entries(views)) console.log(`  ${view.padEnd(6)} ${projection.elements} elements, hash ${projection.hash}`);
  if (deskState) console.log(`  desk   ${deskState.projection.elements} elements, hash ${deskState.projection.hash}`);
  await browser.close();
}

const difference = (left, right) => ({
  lost: left.filter((name) => !right.includes(name)),
  gained: right.filter((name) => !left.includes(name))
});

function compare(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));

  let identical = true;
  for (const [label, left, right] of [
    ["main window classes", before.mainClasses, after.mainClasses],
    ["desk classes", before.desk?.classes ?? [], after.desk?.classes ?? []]
  ]) {
    const { lost, gained } = difference(left, right);
    console.log(`${label}: ${left.length} -> ${right.length}${lost.length || gained.length ? "" : " (identical)"}`);
    if (lost.length) console.log(`  lost  : ${lost.join(", ")}`);
    if (gained.length) console.log(`  gained: ${gained.join(", ")}`);
    identical = identical && lost.length === 0 && gained.length === 0;
  }

  for (const [label, left, right] of [
    ...Object.keys(before.views).map((view) => [`view ${view}`, before.views[view], after.views[view]]),
    ["desk", before.desk?.projection, after.desk?.projection]
  ]) {
    if (!left || !right) {
      console.log(`${label}: missing on one side`);
      identical = false;
      continue;
    }
    if (left.hash === right.hash) {
      console.log(`${label}: identical (${left.elements} elements, ${left.hash})`);
      continue;
    }
    const leftRows = new Map(left.rows.map((row, index) => [`${index}|${row.selector}`, row.hash]));
    const rightRows = new Map(right.rows.map((row, index) => [`${index}|${row.selector}`, row.hash]));
    const differing = [...leftRows].filter(([key, hash]) => rightRows.has(key) && rightRows.get(key) !== hash);
    console.log(
      `${label}: ${left.elements} -> ${right.elements} elements, hash ${left.hash} -> ${right.hash}; ` +
        `${differing.length} differing element(s), ${[...leftRows.keys()].filter((key) => !rightRows.has(key)).length} only-before, ` +
        `${[...rightRows.keys()].filter((key) => !leftRows.has(key)).length} only-after`
    );
    for (const [key] of differing.slice(0, 5)) console.log(`    differs: ${key}`);
    identical = false;
  }
  console.log(
    identical
      ? "\nall captures identical"
      : "\nsome captures differ - compare against a repeat capture of the same state before calling it a regression"
  );
  process.exitCode = identical ? 0 : 1;
}

const [command, ...args] = process.argv.slice(2);
if (command === "collect") {
  const [out] = args;
  if (!out) throw new Error("usage: ui-state.mjs collect <out.json>");
  await collect(resolve(out));
} else if (command === "compare") {
  const [beforePath, afterPath] = args;
  if (!beforePath || !afterPath) throw new Error("usage: ui-state.mjs compare <before.json> <after.json>");
  compare(resolve(beforePath), resolve(afterPath));
} else {
  throw new Error("usage: ui-state.mjs collect <out.json> | compare <before.json> <after.json>");
}
