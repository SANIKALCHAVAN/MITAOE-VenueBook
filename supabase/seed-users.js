/**
 * MITAOE VenueBook - Supabase User Provisioning & Seeding Script
 * Creates the initial Admin, Teacher, and Student accounts in Supabase Auth & PostgreSQL.
 *
 * Usage:
 *   node supabase/seed-users.js
 */

import dotenv from "dotenv";
dotenv.config({ override: true });

import { isSupabaseConfigured, supabaseAdmin, checkSupabaseSchema } from "../server/supabase.js";

const SEED_USERS = [
  {
    role: "admin",
    email: "admin@mitaoe.ac.in",
    password: process.env.ADMIN_INITIAL_PASSWORD || "Admin@MITAOE2026",
    full_name: "MITAOE Campus Administrator",
    department: "Campus Administration",
    prn: null
  },
  {
    role: "teacher",
    email: "prof.sharma@mitaoe.ac.in",
    password: process.env.TEACHER_INITIAL_PASSWORD || "Teacher@MITAOE2026",
    full_name: "Prof. Rajesh Sharma",
    department: "Computer Engineering",
    prn: null
  },
  {
    role: "teacher",
    email: "prof.patil@mitaoe.ac.in",
    password: process.env.TEACHER_INITIAL_PASSWORD || "Teacher@MITAOE2026",
    full_name: "Dr. Sunita Patil",
    department: "Electronics Engineering",
    prn: null
  },
  {
    role: "student",
    prn: "PRN2024001",
    email: "aarav.patil@student.mitaoe.ac.in",
    password: process.env.STUDENT_INITIAL_PASSWORD || "Student@MITAOE2026",
    full_name: "Aarav Patil",
    department: "Computer Engineering"
  },
  {
    role: "student",
    prn: "PRN2024002",
    email: "meera.joshi@student.mitaoe.ac.in",
    password: process.env.STUDENT_INITIAL_PASSWORD || "Student@MITAOE2026",
    full_name: "Meera Joshi",
    department: "Information Technology"
  },
  {
    role: "student",
    prn: "PRN2024003",
    email: "rohan.u@student.mitaoe.ac.in",
    password: process.env.STUDENT_INITIAL_PASSWORD || "Student@MITAOE2026",
    full_name: "Rohan Umbarepatil",
    department: "Mechanical Engineering"
  }
];

async function seed() {
  console.log("=================================================");
  console.log("MITAOE VenueBook: Supabase Auth Provisioning");
  console.log("=================================================");

  if (!isSupabaseConfigured) {
    console.error("[Error] Supabase credentials not found in environment.");
    console.error("Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running this script.");
    process.exit(1);
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
    console.error("4. Rerun 'node supabase/seed-users.js' to complete user provisioning.\n");
    return;
  }

  for (const u of SEED_USERS) {
    console.log(`\nProvisioning [${u.role.toUpperCase()}] ${u.full_name} (${u.prn ? u.prn : u.email})...`);

    // Check if profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .eq("email", u.email)
      .maybeSingle();

    if (existingProfile) {
      console.log(`  - Account already exists with ID: ${existingProfile.id}`);
      // Update role and PRN
      await supabaseAdmin.from("profiles").update({
        role: u.role,
        prn: u.prn,
        full_name: u.full_name,
        department: u.department,
        account_status: "active",
        email_verified: true
      }).eq("id", existingProfile.id);
      continue;
    }

    // Create in Supabase Auth
    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: {
        full_name: u.full_name,
        role: u.role,
        prn: u.prn,
        department: u.department
      }
    });

    if (authErr) {
      console.error(`  - Failed to create Auth user: ${authErr.message}`);
      continue;
    }

    // Upsert into profiles
    const { error: profErr } = await supabaseAdmin.from("profiles").upsert({
      id: authUser.user.id,
      prn: u.prn,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      department: u.department,
      account_status: "active",
      email_verified: true
    });

    if (profErr) {
      console.error(`  - Failed to create profile record: ${profErr.message}`);
    } else {
      console.log(`  ✓ Provisioned successfully (Auth ID: ${authUser.user.id})`);
    }
  }

  console.log("\nAll seed users provisioned successfully in Supabase!");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
