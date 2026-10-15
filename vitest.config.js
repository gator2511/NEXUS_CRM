import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_DEMO_MODE": JSON.stringify("true") },
  test: {
    environment: "jsdom",
    include: ["tests/*.ui.test.jsx"],
    testTimeout: 30000,
  },
});
