import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashPassword } from "./auth.js";
import { generateApprovalPdf, DOCUMENTS_DIR } from "./documentGenerator.js";
import { STUDENTS_LIST, CLASS_COORDINATOR } from "./studentsData.js";

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "venuebook.db");
export const db = new DatabaseSync(DB_PATH);

// Configure WAL mode and foreign keys for durability and performance
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 10000;");

// Initialize Schema
export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      prn TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'admin')),
      department TEXT,
      account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active', 'disabled', 'pending_verification')),
      email_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity > 0),
      facilities TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT 'lavender',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
      event_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      end_date TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      attendee_count INTEGER NOT NULL CHECK(attendee_count > 0),
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
      rejection_reason TEXT,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS booking_documents (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      document_reference TEXT NOT NULL UNIQUE,
      approval_reference TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'approval_summary',
      file_path TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_size INTEGER DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      generation_status TEXT NOT NULL CHECK(generation_status IN ('pending', 'generating', 'ready', 'failed')),
      generated_at TEXT,
      generated_by TEXT REFERENCES users(id),
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(booking_id, document_type)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_prn ON users(prn);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_bookings_venue_date ON bookings(venue_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_bookings_requester ON bookings(requester_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    CREATE INDEX IF NOT EXISTS idx_booking_documents_booking ON booking_documents(booking_id);
    CREATE INDEX IF NOT EXISTS idx_booking_documents_ref ON booking_documents(document_reference);
  `);

  const alterStatements = [
    "ALTER TABLE bookings ADD COLUMN end_date TEXT;",
    "ALTER TABLE bookings ADD COLUMN time_slot TEXT;",
    "ALTER TABLE bookings ADD COLUMN admin_remark TEXT;",
    "ALTER TABLE venues ADD COLUMN images TEXT;",
    "ALTER TABLE users ADD COLUMN sr_no INTEGER;",
    "ALTER TABLE users ADD COLUMN batch TEXT;",
    "ALTER TABLE users ADD COLUMN mobile TEXT;",
    "ALTER TABLE users ADD COLUMN division TEXT;",
    "ALTER TABLE users ADD COLUMN coordinator TEXT;",
    "ALTER TABLE users ADD COLUMN avatar_url TEXT;"
  ];
  for (const stmt of alterStatements) {
    try {
      db.exec(stmt);
    } catch (e) {
      // Column already exists
    }
  }

  seedData();
}

// Seed initial system users, venues, and starter data
function seedData() {
  const now = new Date().toISOString();

  // 1. Ensure Administrator & Class Coordinator Accounts
  const adminPasswordHash = hashPassword("Admin@MITAOE2026");

  // Main admin
  const existingAdmin = db.prepare("SELECT id FROM users WHERE email = 'admin@mitaoe.ac.in'").get();
  if (!existingAdmin) {
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, division, coordinator, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'admin', 'Campus Administration', 'Div-A', 'Dr. Deepak Mishra', 'active', 1, ?, ?)
    `).run("usr-admin-01", "admin@mitaoe.ac.in", adminPasswordHash, "MITAOE Venue Administrator", now, now);
  }

  // Class Coordinator: Dr. Deepak Mishra (Div-A)
  const existingCoordinator = db.prepare("SELECT id FROM users WHERE email = ?").get(CLASS_COORDINATOR.email);
  if (!existingCoordinator) {
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, division, coordinator, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'admin', 'Computer Engineering', 'Div-A', 'Dr. Deepak Mishra', 'active', 1, ?, ?)
    `).run("usr-coord-deepak", CLASS_COORDINATOR.email, adminPasswordHash, "Dr. Deepak Mishra (Class Coordinator Div-A)", now, now);
  }

  // 2. Pre-provisioned Teacher accounts
  const teacherPasswordHash = hashPassword("Teacher@MITAOE2026");
  const checkTeacher = db.prepare("SELECT id FROM users WHERE email = ?");
  if (!checkTeacher.get("prof.sharma@mitaoe.ac.in")) {
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, division, coordinator, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'teacher', ?, 'Div-A', 'Dr. Deepak Mishra', 'active', 1, ?, ?)
    `).run("usr-teach-01", "prof.sharma@mitaoe.ac.in", teacherPasswordHash, "Prof. Rajesh Sharma", "Computer Engineering", now, now);
  }
  if (!checkTeacher.get("prof.patil@mitaoe.ac.in")) {
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, division, coordinator, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'teacher', ?, 'Div-A', 'Dr. Deepak Mishra', 'active', 1, ?, ?)
    `).run("usr-teach-02", "prof.patil@mitaoe.ac.in", teacherPasswordHash, "Dr. Sunita Patil", "Electronics Engineering", now, now);
  }

  // 3. Seed / Update ALL 74 Students from the official TY Div-A Roll Call List (only once if not fully seeded)
  const isFullySeeded = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student' AND sr_no = 74").get()?.count > 0;
  if (!isFullySeeded) {
    db.exec("BEGIN IMMEDIATE;");
    try {
      const studentPasswordHash = hashPassword("Student@MITAOE2026");
      const checkStudentByPrn = db.prepare("SELECT id FROM users WHERE prn = ?");
      const insertStudent = db.prepare(`
        INSERT INTO users (id, prn, email, password_hash, full_name, role, department, division, coordinator, account_status, email_verified, sr_no, batch, mobile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'student', 'Computer Engineering', 'Div-A', 'Dr. Deepak Mishra', 'active', 1, ?, ?, ?, ?, ?)
      `);
      const updateStudent = db.prepare(`
        UPDATE users SET sr_no = ?, batch = ?, mobile = ?, full_name = ?, email = ?, division = 'Div-A', coordinator = 'Dr. Deepak Mishra'
        WHERE prn = ?
      `);

      for (const s of STUDENTS_LIST) {
        const existing = checkStudentByPrn.get(s.prn);
        if (!existing) {
          insertStudent.run(`usr-stud-${s.prn}`, s.prn, s.email, studentPasswordHash, s.full_name, s.sr_no, s.batch, s.mobile, now, now);
        } else {
          updateStudent.run(s.sr_no, s.batch, s.mobile, s.full_name, s.email, s.prn);
        }
      }

      // Also ensure legacy test student accounts exist if not present
      const legacyTestStudents = [
        { prn: "PRN2024001", email: "aarav.patil@student.mitaoe.ac.in", name: "Aarav Patil", dept: "Computer Engineering" },
        { prn: "PRN2024002", email: "meera.joshi@student.mitaoe.ac.in", name: "Meera Joshi", dept: "Information Technology" },
        { prn: "PRN2024003", email: "rohan.u@student.mitaoe.ac.in", name: "Rohan Umbarepatil", dept: "Mechanical Engineering" }
      ];
      for (const lt of legacyTestStudents) {
        if (!checkStudentByPrn.get(lt.prn)) {
          insertStudent.run(`usr-stud-${lt.prn}`, lt.prn, lt.email, studentPasswordHash, lt.name, 999, "A1", "9876543210", now, now);
        }
      }
      db.exec("COMMIT;");
    } catch (e) {
      try { db.exec("ROLLBACK;"); } catch {}
    }
  }

  // 4. Venues & Rooms Seeding with Multiple Photos
  const venues = [
    {
      id: "v1",
      name: "Main Auditorium",
      category: "Auditorium",
      capacity: 500,
      location: "Main Central Building, Ground Floor",
      facilities: ["Projector & 4K Screen", "Dolby Audio System", "Stage Lighting", "Central AC", "Wi-Fi 6", "Podium with Mic"],
      color: "lavender",
      images: ["/imgs/Modern Auditorium Conference Hall.png"],
      description: "Grand multi-tier auditorium for university symposiums, annual festivals, hackathons, and guest keynote seminars."
    },
    {
      id: "v2",
      name: "Seminar Hall A",
      category: "Seminar Hall",
      capacity: 120,
      location: "Academic Block 1, 2nd Floor",
      facilities: ["Dual Projectors", "Surround Audio", "Microphone", "Podium", "High-speed Wi-Fi", "Air Conditioned"],
      color: "blue",
      images: ["/imgs/Modern Seminar Hall A.png"],
      description: "Tiered auditorium-style seminar hall ideal for departmental seminars, workshops, and project viva sessions."
    },
    {
      id: "v3",
      name: "Seminar Hall B",
      category: "Seminar Hall",
      capacity: 80,
      location: "Academic Block 2, 3rd Floor",
      facilities: ["Interactive Screen", "Wi-Fi", "PA System", "Whiteboard", "Air Conditioned"],
      color: "mint",
      images: ["/imgs/Modern Seminar Hall B.png"],
      description: "Compact modern presentation hall perfect for student paper presentations, club meetups, and technical workshops."
    },
    {
      id: "v4",
      name: "Corporate Boardroom & Conference Room",
      category: "Meeting Room",
      capacity: 24,
      location: "Administrative Building, 1st Floor",
      facilities: ["Hybrid Video Conferencing", "Conference Mic Array", "Ultra-HD Screen", "Wi-Fi", "Executive Leather Seating"],
      color: "peach",
      images: ["/imgs/Modern Wood-Toned Corporate Boardroom.png"],
      description: "Premium conference suite equipped for institutional committee meetings, faculty interviews, and guest discussions."
    },
    {
      id: "v5",
      name: "High-Tech Innovation & IoT Lab",
      category: "Innovation Lab",
      capacity: 60,
      location: "Innovation Centre, 1st Floor",
      facilities: ["Smart Board", "Movable Workbenches", "Power Tracks", "Gigabit LAN & Wi-Fi", "Development Kits"],
      color: "pink",
      images: ["/imgs/Modern High-Tech Innovation Room.png"],
      description: "High-tech creative lab tailored for design thinking, IoT prototyping, hackathon sprints, and collaborative building."
    },
    {
      id: "v6",
      name: "Student Activity & Cultural Hall",
      category: "Common Space",
      capacity: 100,
      location: "Student Activity Centre, Ground Floor",
      facilities: ["Flexible Modular Seating", "Acoustic Wall Panels", "Audio System", "High Power Outlets"],
      color: "yellow",
      images: ["/imgs/Spacious Modern Activity Hall.png"],
      description: "Spacious multi-purpose activity hall for college club rehearsals, competitions, poster exhibitions, and student gatherings."
    }
  ];

  const checkVenue = db.prepare("SELECT id FROM venues WHERE id = ?");
  const insertVenue = db.prepare(`
    INSERT INTO venues (id, name, category, location, capacity, facilities, description, color, images, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const updateVenueQuery = db.prepare(`
    UPDATE venues SET name = ?, category = ?, location = ?, capacity = ?, facilities = ?, description = ?, color = ?, images = ?
    WHERE id = ?
  `);

  for (const v of venues) {
    const existing = checkVenue.get(v.id);
    const facilitiesJson = JSON.stringify(v.facilities);
    const imagesJson = JSON.stringify(v.images);
    if (!existing) {
      insertVenue.run(v.id, v.name, v.category, v.location, v.capacity, facilitiesJson, v.description, v.color, imagesJson, now, now);
    } else {
      updateVenueQuery.run(v.name, v.category, v.location, v.capacity, facilitiesJson, v.description, v.color, imagesJson, v.id);
    }
  }

  // 5. Seed realistic date-sorted bookings if few bookings exist
  const bookingCount = db.prepare("SELECT COUNT(*) as count FROM bookings").get().count;
  if (bookingCount < 5) {
    const today = new Date();
    const d1 = new Date(today.getTime() + 86400000 * 1).toISOString().split("T")[0];
    const d2 = new Date(today.getTime() + 86400000 * 2).toISOString().split("T")[0];
    const d3 = new Date(today.getTime() + 86400000 * 3).toISOString().split("T")[0];
    const d4 = new Date(today.getTime() + 86400000 * 4).toISOString().split("T")[0];
    const d5 = new Date(today.getTime() + 86400000 * 5).toISOString().split("T")[0];

    const sampleRequests = [
      {
        id: "b-mitaoe-01",
        requester_prn: "202401070001", // PURI AJIT VASHISHT (A1)
        venue_id: "v2",
        event_name: "TY Project Phase-I Progress Review",
        event_type: "Academic",
        event_date: d2,
        time_slot: "Morning (09:00 AM - 12:00 PM)",
        start_time: "09:00",
        end_time: "12:00",
        attendee_count: 40,
        purpose: "Internal technical milestone presentation before Class Coordinator Dr. Deepak Mishra and panel.",
        status: "approved",
        admin_remark: "Approved. Ensure projector and AV system are returned in working order.",
        reviewed_by: "usr-admin-01"
      },
      {
        id: "b-mitaoe-02",
        requester_prn: "202401070029", // PATIL RUSHALI SANJAY (A2)
        venue_id: "v5",
        event_name: "AI & Smart Campus Hackathon Briefing",
        event_type: "Club Meeting",
        event_date: d3,
        time_slot: "Afternoon (01:00 PM - 04:00 PM)",
        start_time: "13:00",
        end_time: "16:00",
        attendee_count: 50,
        purpose: "Technical briefing and team registration for inter-college smart campus innovation challenge.",
        status: "approved",
        admin_remark: "Approved. All participants must carry college ID cards.",
        reviewed_by: "usr-admin-01"
      },
      {
        id: "b-mitaoe-03",
        requester_prn: "202401070058", // KRISH RAJESH TAGRAM (A3)
        venue_id: "v1",
        event_name: "MITAOE Annual Coding Championship",
        event_type: "Competition",
        event_date: d5,
        time_slot: "Full Day (09:00 AM - 05:00 PM)",
        start_time: "09:00",
        end_time: "17:00",
        attendee_count: 200,
        purpose: "Division-wide competitive programming tournament organized for TY Computer Engineering students.",
        status: "pending",
        admin_remark: null,
        reviewed_by: null
      },
      {
        id: "b-mitaoe-04",
        requester_prn: "202401070006", // PARTH ATUL WANKHADE (A1)
        venue_id: "v3",
        event_name: "Robotics Club ROS2 Sensor Fusion Demo",
        event_type: "Workshop",
        event_date: d1,
        time_slot: "Afternoon (01:00 PM - 04:00 PM)",
        start_time: "13:00",
        end_time: "16:00",
        attendee_count: 35,
        purpose: "Live demonstration of LiDAR mapping and SLAM navigation on mobile robot chassis.",
        status: "pending",
        admin_remark: null,
        reviewed_by: null
      },
      {
        id: "b-mitaoe-05",
        requester_prn: "202401070035", // MRUNMAYEE SUDHIR PHADTARE (A2)
        venue_id: "v4",
        event_name: "Student Council Term Planning Meeting",
        event_type: "Meeting",
        event_date: d4,
        time_slot: "Morning (09:00 AM - 12:00 PM)",
        start_time: "09:00",
        end_time: "12:00",
        attendee_count: 18,
        purpose: "Discussion of Term-I student events, technical symposiums, and cultural calendar with coordinator.",
        status: "rejected",
        admin_remark: "Executive boardroom reserved for external NAAC inspection committee on this date. Please re-apply for Seminar Hall B.",
        reviewed_by: "usr-admin-01"
      }
    ];

    const insertBooking = db.prepare(`
      INSERT INTO bookings (id, requester_id, venue_id, event_name, event_type, event_date, end_date, time_slot, start_time, end_time, attendee_count, purpose, status, rejection_reason, admin_remark, reviewed_by, reviewed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const sb of sampleRequests) {
      const studentUser = db.prepare("SELECT id FROM users WHERE prn = ?").get(sb.requester_prn);
      if (studentUser && !db.prepare("SELECT id FROM bookings WHERE id = ?").get(sb.id)) {
        insertBooking.run(
          sb.id,
          studentUser.id,
          sb.venue_id,
          sb.event_name,
          sb.event_type,
          sb.event_date,
          sb.event_date,
          sb.time_slot,
          sb.start_time,
          sb.end_time,
          sb.attendee_count,
          sb.purpose,
          sb.status,
          sb.status === "rejected" ? sb.admin_remark : null,
          sb.admin_remark,
          sb.reviewed_by,
          sb.reviewed_by ? now : null,
          now,
          now
        );
      }
    }
  }
}

// Ensure database is initialized on import
initSchema();

// ----------------- USER QUERIES -----------------

export function getUserById(id) {
  const user = db.prepare("SELECT id, prn, email, full_name, role, department, account_status, email_verified, created_at, updated_at FROM users WHERE id = ?").get(id);
  return user || null;
}

export function getUserByPrn(prn) {
  if (!prn) return null;
  return db.prepare("SELECT * FROM users WHERE UPPER(prn) = UPPER(?)").get(prn.trim()) || null;
}

export function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim()) || null;
}

export function createUser({ prn = null, email = null, password, full_name, role, department = null, account_status = "active", email_verified = 1 }) {
  if (role === "student" && !prn) {
    throw new Error("PRN is strictly required for student accounts");
  }
  if ((role === "teacher" || role === "admin") && !email) {
    throw new Error("Email is required for teacher and admin accounts");
  }

  const id = "usr-" + crypto.randomUUID();
  const password_hash = hashPassword(password);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    prn ? prn.trim().toUpperCase() : null,
    email ? email.trim().toLowerCase() : null,
    password_hash,
    full_name.trim(),
    role,
    department ? department.trim() : null,
    account_status,
    email_verified ? 1 : 0,
    now,
    now
  );

  return getUserById(id);
}

export function updateUserPassword(id, newPassword) {
  const password_hash = hashPassword(newPassword);
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(password_hash, now, id);
}

export function listUsers({ role, search } = {}) {
  let query = "SELECT id, prn, email, full_name, role, department, account_status, email_verified, created_at FROM users WHERE 1=1";
  const params = [];

  if (role) {
    query += " AND role = ?";
    params.push(role);
  }
  if (search) {
    query += " AND (full_name LIKE ? OR prn LIKE ? OR email LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += " ORDER BY created_at DESC";
  return db.prepare(query).all(...params);
}

// ----------------- VENUE QUERIES -----------------

export function getVenues({ includeInactive = false } = {}) {
  const sql = includeInactive
    ? "SELECT * FROM venues ORDER BY name ASC"
    : "SELECT * FROM venues WHERE is_active = 1 ORDER BY name ASC";
  
  const rows = db.prepare(sql).all();
  return rows.map((r) => ({
    ...r,
    facilities: JSON.parse(r.facilities || "[]"),
    images: r.images ? JSON.parse(r.images) : [],
    is_active: Boolean(r.is_active)
  }));
}

export function getVenueById(id) {
  const r = db.prepare("SELECT * FROM venues WHERE id = ?").get(id);
  if (!r) return null;
  return {
    ...r,
    facilities: JSON.parse(r.facilities || "[]"),
    images: r.images ? JSON.parse(r.images) : [],
    is_active: Boolean(r.is_active)
  };
}

export function createVenue({ name, category, location, capacity, facilities = [], description = "", color = "lavender", images = [], is_active = 1 }) {
  const id = "v-" + crypto.randomUUID();
  const now = new Date().toISOString();
  const facilitiesJson = JSON.stringify(facilities);
  const imagesJson = JSON.stringify(Array.isArray(images) ? images : (images ? [images] : []));

  db.prepare(`
    INSERT INTO venues (id, name, category, location, capacity, facilities, description, color, images, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), category.trim(), location.trim(), Number(capacity), facilitiesJson, description.trim(), color, imagesJson, is_active ? 1 : 0, now, now);

  return getVenueById(id);
}

export function updateVenue(id, { name, category, location, capacity, facilities, description, color, images, is_active }) {
  const venue = getVenueById(id);
  if (!venue) throw new Error("Venue not found");

  const updatedName = name !== undefined ? name.trim() : venue.name;
  const updatedCategory = category !== undefined ? category.trim() : venue.category;
  const updatedLocation = location !== undefined ? location.trim() : venue.location;
  const updatedCapacity = capacity !== undefined ? Number(capacity) : venue.capacity;
  const updatedFacilities = facilities !== undefined ? JSON.stringify(facilities) : JSON.stringify(venue.facilities);
  const updatedDesc = description !== undefined ? description.trim() : venue.description;
  const updatedColor = color !== undefined ? color : venue.color;
  const updatedImages = images !== undefined ? JSON.stringify(Array.isArray(images) ? images : [images]) : JSON.stringify(venue.images || []);
  const updatedActive = is_active !== undefined ? (is_active ? 1 : 0) : (venue.is_active ? 1 : 0);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE venues
    SET name = ?, category = ?, location = ?, capacity = ?, facilities = ?, description = ?, color = ?, images = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(updatedName, updatedCategory, updatedLocation, updatedCapacity, updatedFacilities, updatedDesc, updatedColor, updatedImages, updatedActive, now, id);

  return getVenueById(id);
}

// ----------------- STUDENT ROSTER QUERIES -----------------

export function getAllStudents() {
  const query = `
    SELECT u.id, u.prn, u.full_name, u.email, u.mobile, u.batch, u.sr_no, u.division, u.coordinator, u.account_status,
           COUNT(b.id) as total_bookings,
           SUM(CASE WHEN b.status = 'approved' THEN 1 ELSE 0 END) as approved_bookings,
           SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) as pending_bookings,
           SUM(CASE WHEN b.status = 'rejected' THEN 1 ELSE 0 END) as rejected_bookings
    FROM users u
    LEFT JOIN bookings b ON b.requester_id = u.id
    WHERE u.role = 'student'
    GROUP BY u.id
    ORDER BY u.sr_no ASC, u.prn ASC
  `;
  return db.prepare(query).all();
}

// ----------------- BOOKING QUERIES -----------------

export function getBookingById(id) {
  const row = db.prepare(`
    SELECT b.*,
           v.name as venue_name, v.category as venue_category, v.location as venue_location, v.capacity as venue_capacity, v.color as venue_color, v.facilities as venue_facilities, v.images as venue_images,
           u.full_name as requester_name, u.role as requester_role, u.prn as requester_prn, u.email as requester_email, u.department as requester_department, u.batch as requester_batch, u.mobile as requester_mobile, u.sr_no as requester_sr_no, u.division as requester_division,
           rev.full_name as reviewer_name,
           doc.id as doc_id, doc.document_reference, doc.approval_reference, doc.generation_status as doc_status, doc.generated_at as doc_generated_at, doc.file_name as doc_file_name, doc.file_size as doc_file_size, doc.error_message as doc_error
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    JOIN users u ON u.id = b.requester_id
    LEFT JOIN users rev ON rev.id = b.reviewed_by
    LEFT JOIN booking_documents doc ON doc.booking_id = b.id AND doc.document_type = 'approval_summary'
    WHERE b.id = ?
  `).get(id);

  if (!row) return null;
  return {
    ...row,
    facilities: row.venue_facilities ? (typeof row.venue_facilities === "string" ? JSON.parse(row.venue_facilities) : row.venue_facilities) : [],
    images: row.venue_images ? (typeof row.venue_images === "string" ? JSON.parse(row.venue_images) : row.venue_images) : [],
    start_date: row.event_date,
    end_date: row.end_date || row.event_date,
    document: row.doc_id ? {
      id: row.doc_id,
      booking_id: row.id,
      document_reference: row.document_reference,
      approval_reference: row.approval_reference,
      generation_status: row.doc_status,
      generated_at: row.doc_generated_at,
      file_name: row.doc_file_name,
      file_size: row.doc_file_size,
      error_message: row.doc_error
    } : null
  };
}

export function getBookings({ userId = null, role = null, status = null, venue_id = null, batch = null, date_group = null, date_from = null, date_to = null, search = null, sort_by = "event_date_desc" } = {}) {
  let query = `
    SELECT b.*,
           v.name as venue_name, v.category as venue_category, v.location as venue_location, v.capacity as venue_capacity, v.color as venue_color, v.facilities as venue_facilities, v.images as venue_images,
           u.full_name as requester_name, u.role as requester_role, u.prn as requester_prn, u.email as requester_email, u.department as requester_department, u.batch as requester_batch, u.mobile as requester_mobile, u.sr_no as requester_sr_no, u.division as requester_division,
           rev.full_name as reviewer_name,
           doc.id as doc_id, doc.document_reference, doc.approval_reference, doc.generation_status as doc_status, doc.generated_at as doc_generated_at, doc.file_name as doc_file_name, doc.file_size as doc_file_size, doc.error_message as doc_error
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    JOIN users u ON u.id = b.requester_id
    LEFT JOIN users rev ON rev.id = b.reviewed_by
    LEFT JOIN booking_documents doc ON doc.booking_id = b.id AND doc.document_type = 'approval_summary'
    WHERE 1=1
  `;
  const params = [];

  // Data isolation: non-admin users only see their own bookings
  if (role !== "admin") {
    if (!userId) return [];
    query += " AND b.requester_id = ?";
    params.push(userId);
  }

  if (status && status !== "all") {
    query += " AND b.status = ?";
    params.push(status);
  }

  if (venue_id && venue_id !== "all") {
    query += " AND b.venue_id = ?";
    params.push(venue_id);
  }

  if (batch && batch !== "all") {
    query += " AND u.batch = ?";
    params.push(batch);
  }

  // Handle date grouping (Today, Tomorrow, This Week, Upcoming)
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  const in7Days = new Date(now.getTime() + 7 * 86400000);
  const in7DaysStr = in7Days.toISOString().split("T")[0];

  if (date_group === "today") {
    query += " AND b.event_date = ?";
    params.push(todayStr);
  } else if (date_group === "tomorrow") {
    query += " AND b.event_date = ?";
    params.push(tomorrowStr);
  } else if (date_group === "this_week") {
    query += " AND b.event_date >= ? AND b.event_date <= ?";
    params.push(todayStr, in7DaysStr);
  } else if (date_group === "upcoming") {
    query += " AND b.event_date >= ?";
    params.push(todayStr);
  } else {
    if (date_from) {
      query += " AND (b.end_date >= ? OR (b.end_date IS NULL AND b.event_date >= ?))";
      params.push(date_from, date_from);
    }
    if (date_to) {
      query += " AND b.event_date <= ?";
      params.push(date_to);
    }
  }

  if (search) {
    query += " AND (b.event_name LIKE ? OR b.id LIKE ? OR u.full_name LIKE ? OR u.prn LIKE ? OR v.name LIKE ? OR b.purpose LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s, s, s, s);
  }

  // Strict date ordering: default newest event date first, with selectable sort options
  if (sort_by === "event_date_asc") {
    query += " ORDER BY b.event_date ASC, b.start_time ASC, b.created_at ASC";
  } else if (sort_by === "created_at_desc") {
    query += " ORDER BY b.created_at DESC";
  } else if (sort_by === "created_at_asc") {
    query += " ORDER BY b.created_at ASC";
  } else {
    // Default: strictly sorted by event date newest first, then start_time, then submission timestamp
    query += " ORDER BY b.event_date DESC, b.start_time DESC, b.created_at DESC";
  }

  const rows = db.prepare(query).all(...params);
  return rows.map((r) => ({
    ...r,
    facilities: r.venue_facilities ? (typeof r.venue_facilities === "string" ? JSON.parse(r.venue_facilities) : r.venue_facilities) : [],
    images: r.venue_images ? (typeof r.venue_images === "string" ? JSON.parse(r.venue_images) : r.venue_images) : [],
    start_date: r.event_date,
    end_date: r.end_date || r.event_date,
    document: r.doc_id ? {
      id: r.doc_id,
      booking_id: r.id,
      document_reference: r.document_reference,
      approval_reference: r.approval_reference,
      generation_status: r.doc_status,
      generated_at: r.doc_generated_at,
      file_name: r.doc_file_name,
      file_size: r.doc_file_size,
      error_message: r.doc_error
    } : null
  }));
}

export function createBooking({ requester_id, venue_id, event_name, event_type, start_date, end_date, event_date, time_slot = null, start_time, end_time, attendee_count, purpose }) {
  const venue = getVenueById(venue_id);
  if (!venue) throw new Error("Venue does not exist");
  if (!venue.is_active) throw new Error("Venue is currently inactive and cannot accept bookings");

  const attendees = Number(attendee_count);
  if (isNaN(attendees) || attendees < 1) throw new Error("Attendee count must be at least 1");
  if (attendees > venue.capacity) {
    throw new Error(`Requested attendee count (${attendees}) exceeds venue maximum capacity (${venue.capacity})`);
  }

  const startDate = start_date || event_date;
  const endDate = end_date || startDate;

  // Resolve time slot defaults if slot provided but custom times not supplied
  let startTime = start_time;
  let endTime = end_time;
  if (!startTime || !endTime) {
    if (time_slot === "Morning" || time_slot === "Morning (09:00 AM - 12:00 PM)") {
      startTime = "09:00";
      endTime = "12:00";
    } else if (time_slot === "Afternoon" || time_slot === "Afternoon (01:00 PM - 04:00 PM)") {
      startTime = "13:00";
      endTime = "16:00";
    } else if (time_slot === "Evening" || time_slot === "Evening (04:00 PM - 07:00 PM)") {
      startTime = "16:00";
      endTime = "19:00";
    } else if (time_slot === "Full Day" || time_slot === "Full Day (09:00 AM - 05:00 PM)") {
      startTime = "09:00";
      endTime = "17:00";
    } else {
      startTime = startTime || "10:00";
      endTime = endTime || "11:00";
    }
  }

  const slotLabel = time_slot || `${startTime} - ${endTime}`;

  if (endDate < startDate) {
    throw new Error("Ending date cannot be earlier than starting date");
  }

  if (startDate === endDate && startTime >= endTime) {
    throw new Error("Start time must be strictly earlier than end time");
  }

  // Check past date/time validation
  const startDateTime = new Date(`${startDate}T${startTime}`);
  if (isNaN(startDateTime.getTime())) throw new Error("Invalid event date or time format");
  const now = new Date();
  if (startDateTime <= now) {
    throw new Error("Event date and time must be in the future");
  }

  // Pre-validate against overlapping approved bookings
  const conflict = db.prepare(`
    SELECT b.id, b.event_name, b.start_time, b.end_time
    FROM bookings b
    WHERE b.venue_id = ?
      AND (b.event_date <= ? AND COALESCE(b.end_date, b.event_date) >= ?)
      AND b.status = 'approved'
      AND b.start_time < ?
      AND b.end_time > ?
  `).get(venue_id, endDate, startDate, endTime, startTime);

  if (conflict) {
    const err = new Error(`Time slot conflict: Venue is already booked for "${conflict.event_name}" (${conflict.start_time} - ${conflict.end_time})`);
    err.code = "CONFLICT";
    throw err;
  }

  const id = "b-" + crypto.randomUUID().substring(0, 8);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO bookings (id, requester_id, venue_id, event_name, event_type, event_date, end_date, time_slot, start_time, end_time, attendee_count, purpose, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, requester_id, venue_id, (event_name || purpose || "Facility Booking").trim(), (event_type || "Academic").trim(), startDate, endDate, slotLabel, startTime, endTime, attendees, purpose.trim(), nowIso, nowIso);

  return getBookingById(id);
}

// ----------------- BOOKING APPROVAL & DOCUMENTS -----------------

export function getBookingDocument(bookingId, documentType = "approval_summary") {
  return db.prepare(`
    SELECT * FROM booking_documents
    WHERE booking_id = ? AND document_type = ?
  `).get(bookingId, documentType) || null;
}

export function getBookingDocumentByRef(documentReference) {
  return db.prepare(`
    SELECT * FROM booking_documents
    WHERE document_reference = ?
  `).get(documentReference) || null;
}

// ATOMIC APPROVAL WITH CONCURRENCY, CONFLICT LOCKING & AUTOMATIC DOCUMENT GENERATION
export function approveBooking({ bookingId, adminId, remark = "", ipAddress = "127.0.0.1" }) {
  // 1. Check current booking state
  const existing = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
  if (!existing) {
    throw new Error("Booking not found");
  }

  // Idempotency: If booking is ALREADY approved, return existing approval and ensure document exists
  if (existing.status === "approved") {
    const hydrated = getBookingById(bookingId);
    let doc = getBookingDocument(bookingId);

    const promise = (async () => {
      // If no document exists or generation previously failed, attempt recovery
      if (!doc || doc.generation_status === "failed") {
        try {
          const docRef = doc?.document_reference || `DOC-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
          const appRef = doc?.approval_reference || `APP-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
          
          const now = new Date().toISOString();
          db.prepare(`
            INSERT INTO booking_documents (
              id, booking_id, document_reference, approval_reference, document_type,
              file_path, file_name, file_size, mime_type, generation_status,
              generated_at, generated_by, error_message, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'approval_summary', '', '', 0, 'application/pdf', 'generating', NULL, ?, NULL, ?, ?)
            ON CONFLICT(booking_id, document_type) DO UPDATE SET
              generation_status = 'generating',
              error_message = NULL,
              updated_at = excluded.updated_at
          `).run(doc?.id || "doc-" + crypto.randomUUID(), bookingId, docRef, appRef, adminId, now, now);

          const pdfResult = await generateApprovalPdf(hydrated, {
            documentReference: docRef,
            approvalReference: appRef
          });

          const readyNow = new Date().toISOString();
          db.prepare(`
            UPDATE booking_documents
            SET generation_status = 'ready', file_path = ?, file_name = ?, file_size = ?,
                generated_at = ?, error_message = NULL, updated_at = ?
            WHERE booking_id = ? AND document_type = 'approval_summary'
          `).run(pdfResult.filePath, pdfResult.fileName, pdfResult.fileSize, readyNow, readyNow, bookingId);
        } catch (genErr) {
          console.error("PDF recovery error on idempotent check:", genErr.message);
        }
      }
      const finalBooking = getBookingById(bookingId);
      const finalDoc = getBookingDocument(bookingId);
      return {
        ...finalBooking,
        booking: finalBooking,
        document: finalDoc,
        isExisting: true
      };
    })();

    Object.assign(promise, hydrated, {
      booking: hydrated,
      document: doc,
      isExisting: true
    });

    return promise;
  }

  if (existing.status !== "pending") {
    throw new Error(`Cannot approve booking that is currently ${existing.status}`);
  }

  const venue = getVenueById(existing.venue_id);
  if (!venue || !venue.is_active) {
    throw new Error("Cannot approve booking: venue is currently inactive");
  }

  // Pre-check for overlapping APPROVED booking
  const conflict = db.prepare(`
    SELECT b.id, b.event_name, b.start_time, b.end_time, u.full_name as requester_name
    FROM bookings b
    JOIN users u ON u.id = b.requester_id
    WHERE b.venue_id = ?
      AND (b.event_date <= ? AND COALESCE(b.end_date, b.event_date) >= ?)
      AND b.status = 'approved'
      AND b.id != ?
      AND b.start_time < ?
      AND b.end_time > ?
  `).get(existing.venue_id, existing.end_date || existing.event_date, existing.event_date, existing.id, existing.end_time, existing.start_time);

  if (conflict) {
    const err = new Error(`Approval blocked by booking conflict: "${conflict.event_name}" (${conflict.start_time} - ${conflict.end_time}) by ${conflict.requester_name} is already confirmed for this venue slot`);
    err.code = "CONFLICT";
    throw err;
  }

  // Begin atomic approval transaction
  db.exec("BEGIN IMMEDIATE");
  const now = new Date().toISOString();
  const docRef = `DOC-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const appRef = `APP-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const docId = "doc-" + crypto.randomUUID();

  try {
    // 1. Commit approval status in bookings table
    db.prepare(`
      UPDATE bookings
      SET status = 'approved', admin_remark = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(remark || null, adminId, now, now, bookingId);

    // 2. Audit log
    const logId = "log-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'APPROVE_BOOKING', 'booking', ?, ?, ?, ?)
    `).run(logId, adminId, bookingId, JSON.stringify({
      venue_id: existing.venue_id,
      venue_name: venue.name,
      event_name: existing.event_name,
      event_date: existing.event_date,
      start_time: existing.start_time,
      end_time: existing.end_time,
      approval_reference: appRef
    }), ipAddress, now);

    // 3. Insert or update initial document record with 'generating' status
    db.prepare(`
      INSERT INTO booking_documents (
        id, booking_id, document_reference, approval_reference, document_type,
        file_path, file_name, file_size, mime_type, generation_status,
        generated_at, generated_by, error_message, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'approval_summary', '', '', 0, 'application/pdf', 'generating', NULL, ?, NULL, ?, ?)
      ON CONFLICT(booking_id, document_type) DO UPDATE SET
        document_reference = excluded.document_reference,
        approval_reference = excluded.approval_reference,
        generation_status = 'generating',
        generated_by = excluded.generated_by,
        error_message = NULL,
        updated_at = excluded.updated_at
    `).run(docId, bookingId, docRef, appRef, adminId, now, now);

    // 4. In-app notification
    const notifId = "notif-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO notifications (id, user_id, booking_id, title, message, created_at)
      VALUES (?, ?, ?, 'Booking Approved', ?, ?)
    `).run(
      notifId,
      existing.requester_id,
      bookingId,
      `Your booking request for "${existing.event_name}" at ${venue.name} on ${existing.event_date} (${existing.start_time} - ${existing.end_time}) has been APPROVED. Official approval summary PDF document is being generated.`,
      now
    );

    // Commit database transaction - approval is now authoritative!
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }

  // 5. Hydrate persisted booking with committed approval status
  const hydrated = getBookingById(bookingId);

  // 6. Generate PDF asynchronously while allowing immediate synchronous return
  const promise = (async () => {
    let docRecord = null;
    try {
      const pdfResult = await generateApprovalPdf(hydrated, {
        documentReference: docRef,
        approvalReference: appRef
      });

      const readyNow = new Date().toISOString();
      db.prepare(`
        UPDATE booking_documents
        SET generation_status = 'ready', file_path = ?, file_name = ?, file_size = ?,
            generated_at = ?, error_message = NULL, updated_at = ?
        WHERE booking_id = ? AND document_type = 'approval_summary'
      `).run(pdfResult.filePath, pdfResult.fileName, pdfResult.fileSize, readyNow, readyNow, bookingId);

      // Requester notification for ready document
      const readyNotifId = "notif-" + crypto.randomUUID();
      db.prepare(`
        INSERT INTO notifications (id, user_id, booking_id, title, message, created_at)
        VALUES (?, ?, ?, 'Approval Summary Ready', ?, ?)
      `).run(
        readyNotifId,
        existing.requester_id,
        bookingId,
        `Your official Booking Approval Summary document (PDF) for "${existing.event_name}" is ready to download.`,
        readyNow
      );

      // Audit log for document generation
      const docLogId = "log-" + crypto.randomUUID();
      db.prepare(`
        INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, 'GENERATE_APPROVAL_DOCUMENT', 'booking_document', ?, ?, ?, ?)
      `).run(docLogId, adminId, docId, JSON.stringify({
        booking_id: bookingId,
        document_reference: docRef,
        approval_reference: appRef,
        file_name: pdfResult.fileName,
        file_size: pdfResult.fileSize,
        status: "ready"
      }), ipAddress, readyNow);

      docRecord = getBookingDocument(bookingId);
    } catch (pdfErr) {
      console.error("PDF generation failed:", pdfErr.message);
      const failNow = new Date().toISOString();
      // Do NOT rollback booking approval! Mark document generation as failed.
      db.prepare(`
        UPDATE booking_documents
        SET generation_status = 'failed', error_message = ?, updated_at = ?
        WHERE booking_id = ? AND document_type = 'approval_summary'
      `).run(pdfErr.message, failNow, bookingId);

      // Audit log for document generation failure
      const failLogId = "log-" + crypto.randomUUID();
      db.prepare(`
        INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, 'DOCUMENT_GENERATION_FAILED', 'booking_document', ?, ?, ?, ?)
      `).run(failLogId, adminId, docId, JSON.stringify({
        booking_id: bookingId,
        document_reference: docRef,
        error: pdfErr.message
      }), ipAddress, failNow);

      docRecord = getBookingDocument(bookingId);
    }

    const finalBooking = getBookingById(bookingId);
    return {
      ...finalBooking,
      booking: finalBooking,
      document: docRecord,
      isExisting: false
    };
  })();

  // Synchronously attach committed booking fields onto the returned promise
  Object.assign(promise, hydrated, {
    booking: hydrated,
    document: getBookingDocument(bookingId),
    isExisting: false
  });

  return promise;
}

// RETRY DOCUMENT GENERATION FOR AN APPROVED BOOKING
export async function retryGenerateBookingDocument({ bookingId, adminId, ipAddress = "127.0.0.1" }) {
  const booking = getBookingById(bookingId);
  if (!booking) throw new Error("Booking not found");
  if (booking.status !== "approved") {
    throw new Error(`Cannot generate approval document for a booking that is ${booking.status}`);
  }

  let doc = getBookingDocument(bookingId);
  const docRef = doc?.document_reference || `DOC-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const appRef = doc?.approval_reference || `APP-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const now = new Date().toISOString();

  // If already ready and file exists on disk, return existing
  if (doc && doc.generation_status === "ready" && doc.file_path && fs.existsSync(doc.file_path)) {
    return {
      booking,
      document: doc,
      message: "Approval document is already generated and ready"
    };
  }

  // Set status to generating
  db.prepare(`
    INSERT INTO booking_documents (
      id, booking_id, document_reference, approval_reference, document_type,
      file_path, file_name, file_size, mime_type, generation_status,
      generated_at, generated_by, error_message, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'approval_summary', '', '', 0, 'application/pdf', 'generating', NULL, ?, NULL, ?, ?)
    ON CONFLICT(booking_id, document_type) DO UPDATE SET
      generation_status = 'generating',
      error_message = NULL,
      updated_at = excluded.updated_at
  `).run(doc?.id || "doc-" + crypto.randomUUID(), bookingId, docRef, appRef, adminId, now, now);

  try {
    const pdfResult = await generateApprovalPdf(booking, {
      documentReference: docRef,
      approvalReference: appRef
    });

    const readyNow = new Date().toISOString();
    db.prepare(`
      UPDATE booking_documents
      SET generation_status = 'ready', file_path = ?, file_name = ?, file_size = ?,
          generated_at = ?, error_message = NULL, updated_at = ?
      WHERE booking_id = ? AND document_type = 'approval_summary'
    `).run(pdfResult.filePath, pdfResult.fileName, pdfResult.fileSize, readyNow, readyNow, bookingId);

    // Audit log
    const logId = "log-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'RETRY_GENERATE_DOCUMENT_SUCCESS', 'booking_document', ?, ?, ?, ?)
    `).run(logId, adminId, docRef, JSON.stringify({
      booking_id: bookingId,
      file_name: pdfResult.fileName,
      file_size: pdfResult.fileSize
    }), ipAddress, readyNow);

    return {
      booking: getBookingById(bookingId),
      document: getBookingDocument(bookingId),
      message: "Approval document generated successfully"
    };
  } catch (err) {
    const failNow = new Date().toISOString();
    db.prepare(`
      UPDATE booking_documents
      SET generation_status = 'failed', error_message = ?, updated_at = ?
      WHERE booking_id = ? AND document_type = 'approval_summary'
    `).run(err.message, failNow, bookingId);

    // Audit log
    const logId = "log-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'RETRY_GENERATE_DOCUMENT_FAILED', 'booking_document', ?, ?, ?, ?)
    `).run(logId, adminId, docRef, JSON.stringify({
      booking_id: bookingId,
      error: err.message
    }), ipAddress, failNow);

    throw new Error(`Failed to generate document: ${err.message}`);
  }
}

// REJECT BOOKING WITH MANDATORY REASON
export function rejectBooking({ bookingId, adminId, reason, ipAddress = "127.0.0.1" }) {
  if (!reason || !reason.trim()) {
    throw new Error("A clear rejection reason is mandatory when rejecting a booking request");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
    if (!booking) {
      db.exec("ROLLBACK");
      throw new Error("Booking not found");
    }
    if (booking.status !== "pending") {
      db.exec("ROLLBACK");
      throw new Error(`Cannot reject booking that is currently ${booking.status}`);
    }

    const venue = getVenueById(booking.venue_id);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE bookings
      SET status = 'rejected', rejection_reason = ?, admin_remark = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(reason.trim(), reason.trim(), adminId, now, now, bookingId);

    // Audit log
    const logId = "log-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'REJECT_BOOKING', 'booking', ?, ?, ?, ?)
    `).run(logId, adminId, bookingId, JSON.stringify({
      venue_id: booking.venue_id,
      event_name: booking.event_name,
      reason: reason.trim()
    }), ipAddress, now);

    // In-app notification
    const notifId = "notif-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO notifications (id, user_id, booking_id, title, message, created_at)
      VALUES (?, ?, ?, 'Booking Request Declined', ?, ?)
    `).run(
      notifId,
      booking.requester_id,
      bookingId,
      `Your request for "${booking.event_name}" at ${venue ? venue.name : "the venue"} was not approved. Reason: ${reason.trim()}`,
      now
    );

    db.exec("COMMIT");
    return getBookingById(bookingId);
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }
}

// CANCEL OWN PENDING BOOKING
export function cancelBooking({ bookingId, userId }) {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
  if (!booking) throw new Error("Booking not found");
  if (booking.requester_id !== userId) throw new Error("Unauthorized: You can only cancel your own bookings");
  if (booking.status !== "pending") throw new Error("Only pending booking requests can be cancelled");

  const now = new Date().toISOString();
  db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, bookingId);
  return getBookingById(bookingId);
}

// ----------------- ADMIN DASHBOARD STATS -----------------

export function getStats() {
  const totalBookings = db.prepare("SELECT COUNT(*) as count FROM bookings").get().count;
  const pendingBookings = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'").get().count;
  const approvedBookings = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'approved'").get().count;
  const rejectedBookings = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'rejected'").get().count;
  const activeVenues = db.prepare("SELECT COUNT(*) as count FROM venues WHERE is_active = 1").get().count;

  const today = new Date().toISOString().split("T")[0];
  const upcomingApproved = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'approved' AND event_date >= ?").get(today).count;

  return {
    totalRequests: totalBookings,
    pendingRequests: pendingBookings,
    approvedBookings,
    rejectedRequests: rejectedBookings,
    activeVenues,
    upcomingApproved
  };
}

// ----------------- AUDIT LOGS & NOTIFICATIONS -----------------

export function getAuditLogs({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT a.*, u.full_name as actor_name, u.role as actor_role, u.email as actor_email
    FROM audit_logs a
    JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getNotifications(userId) {
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(userId);
}

export function markNotificationsRead(userId) {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(userId);
}
