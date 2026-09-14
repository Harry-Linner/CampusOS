import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const inspectDirectory = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectDirectory(path);
      continue;
    }
    if (!/\.[cm]?js$/.test(entry.name)) continue;
    const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (node) => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && /^require\d*$/.test(node.expression.text)))
          ? node.arguments[0]
          : undefined;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith("@campusos/")) {
        failures.push(`${path}: ${specifier.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
};

await inspectDirectory(join(root, "packages/core/out/main"));
await inspectDirectory(join(root, "packages/core/out/preload"));
if (failures.length) {
  throw new Error(`Workspace TypeScript modules must be bundled for Electron:\n${failures.join("\n")}`);
}
console.log("Electron bundles contain no external CampusOS workspace imports.");
