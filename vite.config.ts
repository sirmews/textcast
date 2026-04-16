import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@ricky0123/vad-web/dist/*.onnx",
          dest: "./",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
          dest: "./",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: "ort-wasm",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.mjs",
          dest: "ort-wasm",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: "assets",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.mjs",
          dest: "assets",
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  assetsInclude: ["**/*.onnx", "**/*.wasm"],
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Required for SharedArrayBuffer (threading)
  server: {
    port: 4002,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
