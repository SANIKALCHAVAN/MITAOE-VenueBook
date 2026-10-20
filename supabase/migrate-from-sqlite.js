/**
 * MITAOE VenueBook - SQLite to Supabase PostgreSQL Migration Script
 * Migrates existing venues, bookings, profiles, and audit records from SQLite into Supabase PostgreSQL.
 *
 * Usage:
 *   node supabase/migrate-from-sqlite.js
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
dotenv.config({ override: true });

import { isSupabaseConfigured, supabaseAdmin, checkSupabaseSchema } from "../server/supabase.js";

async function runMigration() {
  console.log("=================================================");
  console.log("MITAOE VenueBook: SQLite -> Supabase Migration");
  console.log("=================================================");

  const dbPath = path.resolve(process.cwd(), "data", "venuebook.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`[Error] SQLite database not found at ${dbPath}`);
    return;
  }

  if (!isSupabaseConfigured) {
    console.error("[Error] Supabase credentials not found in environment.");
    console.error("Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running migration.");
    return;
  }

  const schemaCheck = await checkSupabaseSchema();
  if (!schemaCheck.ok) {
    console.error("\n=================================================");
    console.error("  [ACTION REQUIRED] DATABASE SCHEMA NOT INITIALIZED");
    console.error("=================================================");
    console.error("Your Supabase credentials are valid and Auth is reachable,");
    console.error("but the PostgreSQL database tables do not exist yet.");
    console.error("\nNext Steps:");
    console.error("1. Open your Supabase Dashboard: https://supabase.com/dashboard");
    console.error("2. Navigate to 'SQL Editor' in your project.");
    console.error("3. Paste the contents of 'supabase/schema.sql' and click 'Run'.");
    console.error("4. Rerun 'node supabase/migrate-from-sqlite.js' to complete data migration.\n");
    return;
  }

  console.log("[Info] Opening SQLite database...");
  const sqlite = new DatabaseSync(dbPath);

  // 1. Migrate Venues
  console.log("\n[1/3] Migrating Venues...");
  const venues = sqlite.prepare("SELECT * FROM venues").all();
  let venuesMigrated = 0;

  for (const v of venues) {
    const facilities = JSON.parse(v.facilities || "[]");
    const payload = {
      name: v.name,
      venue_type: v.category,
      capacity: v.capacity,
      location: v.location,
      facilities,
      description: v.description || "",
      color: v.color || "lavender",
      is_active: Boolean(v.is_active)
    };

    const { error } = await supabaseAdmin.from("venues").upsert(payload, { onConflict: "name" });
    if (error) {
      console.error(`  - Failed to migrate venue "${v.name}":`, error.message);
    } else {
      venuesMigrated++;
      console.log(`  ✓ Venue: ${v.name} (${v.capacity} capacity)`);
    }
  }
  console.log(`  -> Successfully migrated ${venuesMigrated}/${venues.length} venues.`);

  // 2. Fetch Supabase Venues mapping
  const { data: supaVenues } = await supabaseAdmin.from("venues").select("id, name");
  const venueMap = new Map((supaVenues || []).map((v) => [v.name, v.id]));

  // 3. Migrate Users / Profiles metadata
  console.log("\n[2/3] Checking Authorized Profiles Roster...");
  const users = sqlite.prepare("SELECT * FROM users").all();
  console.log(`  -> Found ${users.length} roster users in SQLite.`);

  // 4. Migrate Bookings
  console.log("\n[3/3] Migrating Bookings...");
  const bookings = sqlite.prepare(`
    SELECT b.*, v.name as venue_name, u.email as requester_email
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    JOIN users u ON u.id = b.requester_id
  `).all();

  let bookingsMigrated = 0;
  for (const b of bookings) {
    const targetVenueId = venueMap.get(b.venue_name);
    if (!targetVenueId) {
      console.warn(`  ! Skipping booking "${b.event_name}": venue "${b.venue_name}" not found in Supabase.`);
      continue;
    }

    // Look up profile by email
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", b.requester_email)
      .maybeSingle();

    if (!profile) {
      console.warn(`  ! Skipping booking "${b.event_name}": requester "${b.requester_email}" has not provisioned a Supabase Auth account yet.`);
      continue;
    }

    const bookingPayload = {
      venue_id: targetVenueId,
      requester_id: profile.id,
      event_title: b.event_name,
      event_type: b.event_type,
      event_date: b.event_date,
      start_time: b.start_time,
      end_time: b.end_time,
      expected_attendees: b.attendee_count,
      purpose: b.purpose,
      status: b.status,
      rejection_reason: b.rejection_reason
    };

    const { error } = await supabaseAdmin.from("bookings").insert(bookingPayload);
    if (error) {
      console.error(`  - Failed to insert booking "${b.event_name}":`, error.message);
    } else {
      bookingsMigrated++;
      console.log(`  ✓ Booking: "${b.event_name}" (${b.event_date})`);
    }
  }

  console.log(`  -> Successfully migrated ${bookingsMigrated}/${bookings.length} bookings.`);

  console.log("\n=================================================");
  console.log("Migration complete! SQLite database preserved at:");
  console.log(`  ${dbPath}`);
  console.log("=================================================");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
