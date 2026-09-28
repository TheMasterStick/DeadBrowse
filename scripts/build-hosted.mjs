import { build } from "esbuild";
import { mkdir, rm, copyFile, readFile } from "node:fs/promises";
// Static assets are embedded in the Worker to avoid a separate asset binding.
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await build({
  entryPoints: ["cloud/worker.js"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  loader: { ".webp": "binary" },
  plugins: [
    {
      name: "game-assets",
      setup(build) {
        build.onLoad(
          { filter: /public\/(app\.js|styles\.css|index\.html)$/ },
          async (args) => ({
            contents: await readFile(args.path, "utf8"),
            loader: "text",
          }),
        );
      },
    },
  ],
});
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
console.log("Built the hosted game Worker.");
