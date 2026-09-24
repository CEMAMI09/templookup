import { cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const ORT_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.jspi.wasm",
  "ort-wasm-simd-threaded.jspi.mjs",
];

const SCRIPT_DEFAULTS: { source: string; file: string; globalName: string }[] = [
  { source: "clipper-lib", file: "node_modules/clipper-lib/clipper.js", globalName: "ClipperLib" },
  { source: "@techstark/opencv-js", file: "node_modules/@techstark/opencv-js/dist/opencv.js", globalName: "cv" },
];

// clipper-lib and opencv.js are browser scripts. Give PaddleOCR a real default export.
function scriptDefaultExport(): Plugin {
  const modules = new Map(
    SCRIPT_DEFAULTS.map((item) => {
      const id = `\0${item.source}`;
      const code = `(function(){\n${readFileSync(path.resolve(item.file), "utf8")}\n}).call(window);\nexport default window.${item.globalName};\n`;
      return [id, { source: item.source, code }] as const;
    }),
  );
  return {
    name: "script-default-export",
    enforce: "pre",
    resolveId(source) {
      for (const [id, item] of modules) {
        if (source === item.source) return id;
      }
      return null;
    },
    load(id) {
      return modules.get(id)?.code ?? null;
    },
  };
}

function copyOrtWasm(): Plugin {
  const copy = () => {
    const source = path.resolve("node_modules/@paddleocr/paddleocr-js/node_modules/onnxruntime-web/dist");
    const target = path.resolve("client/public/ort");
    mkdirSync(target, { recursive: true });
    for (const name of ORT_FILES) cpSync(path.join(source, name), path.join(target, name));
  };
  return {
    name: "copy-ort-wasm",
    buildStart: copy,
    configureServer(server) {
      copy();
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith("/ort/") && req.url.includes("?import")) {
          req.url = req.url.replace("?import", "");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), scriptDefaultExport(), copyOrtWasm()],
  root: "client",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers", "@paddleocr/paddleocr-js"],
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
