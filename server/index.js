import path from "node:path";
import fs from "node:fs";
import express from "express";
import { app } from "./app.js";

const PORT = Number(process.env.PORT) || 5173;
const DIST_DIR = path.resolve(process.cwd(), "dist");

// Serve static frontend files in production if dist/ exists
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));

  // SPA fallback for client-side routing
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      return res.sendFile(path.join(DIST_DIR, "index.html"));
    }
    next();
  });
}

app.listen(PORT, () => {
  console.log(`[MITAOE VenueBook] Node.js + Express server running on http://localhost:${PORT}`);
});
