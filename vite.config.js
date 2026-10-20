import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { app } from "./server/app.js";

function venueBookExpressPlugin() {
  return {
    name: "mitaoe-venuebook-express-api",
    configureServer(server) {
      server.middlewares.use(app);
    },
    configurePreviewServer(server) {
      server.middlewares.use(app);
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), venueBookExpressPlugin()]
});
