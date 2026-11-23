import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { app } from "./server/app.js";

function venueBookExpressPlugin() {
  return {
    name: "mitaoe-venuebook-express-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith("/api") || req.url.startsWith("/uploads") || req.url.startsWith("/imgs")) {
          return app(req, res, next);
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith("/api") || req.url.startsWith("/uploads") || req.url.startsWith("/imgs")) {
          return app(req, res, next);
        }
        next();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), venueBookExpressPlugin()]
});
