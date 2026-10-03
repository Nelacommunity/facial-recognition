import { defineConfig } from "@aixjs/aix";
import { supabaseIdentity } from "./lib/supabase";

// Everything is optional. See https://github.com/Nelacommunity/AIX/blob/main/docs/configuration.md
export default defineConfig({
  // Installable app: manifest, icons, service worker and an offline page. See docs/pwa.md
  pwa: true,
  name: "facial",
  // Page titles, descriptions and robots.txt/sitemap.xml/llms.txt (per-page metadata: routes.ts or `seo()` in a page).
  site: { name: "facial" },
  models: {
    // "auto" picks the best configured model (set a key in .env).
    default: "auto",
  },
  security: {
    // Supabase Auth: verifies the session cookie set by app/api/auth/* on every request.
    identity: supabaseIdentity(),
  },
});
