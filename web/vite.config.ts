import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * Vendor chunks stabil (PERF-9).
 *
 * Dikelompokkan per **paket** (bukan per path file aplikasi) supaya hash chunk
 * tidak hancur setiap commit UI: React, Radix/base-ui, ikon lucide, dan React
 * Flow masing-masing jadi chunk sendiri yang jarang berubah.
 */
const VENDOR_CHUNKS: Array<[name: string, pkg: RegExp]> = [
  ["react", /^(react|react-dom|scheduler)\//],
  ["radix", /^(@radix-ui|radix-ui|@base-ui)\//],
  ["icons", /^lucide-react\//],
  ["xyflow", /^@xyflow\//],
];

const NODE_MODULES = "node_modules/";

function vendorChunkFor(id: string): string | undefined {
  const marker = id.lastIndexOf(NODE_MODULES);
  if (marker === -1) return undefined;
  const pkgPath = id.slice(marker + NODE_MODULES.length);
  for (const [name, pattern] of VENDOR_CHUNKS) {
    if (pattern.test(pkgPath)) return name;
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => vendorChunkFor(id),
      },
    },
  },
});
