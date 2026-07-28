import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://hololiscraft.f0reach.me",
  adapter: cloudflare()
});