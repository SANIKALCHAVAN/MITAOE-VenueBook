import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashPassword } from "./auth.js";

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
  `);

  seedData();
}

// Seed initial system users, venues, and starter data
function seedData() {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  const now = new Date().toISOString();

  if (userCount === 0) {
    // 1. Administrator Account (Securely provisioned for campus admin)
    const adminPasswordHash = hashPassword("Admin@MITAOE2026");
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'admin', 'Campus Administration', 'active', 1, ?, ?)
    `).run("usr-admin-01", "admin@mitaoe.ac.in", adminPasswordHash, "MITAOE Venue Administrator", now, now);

    // 2. Pre-provisioned Teacher accounts (Verified official faculty emails)
    const teacherPasswordHash = hashPassword("Teacher@MITAOE2026");
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'teacher', ?, 'active', 1, ?, ?)
    `).run("usr-teach-01", "prof.sharma@mitaoe.ac.in", teacherPasswordHash, "Prof. Rajesh Sharma", "Computer Engineering", now, now);

    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'teacher', ?, 'active', 1, ?, ?)
    `).run("usr-teach-02", "prof.patil@mitaoe.ac.in", teacherPasswordHash, "Dr. Sunita Patil", "Electronics Engineering", now, now);

    // 3. Pre-provisioned Student accounts (Official PRN-based roster)
    const studentPasswordHash = hashPassword("Student@MITAOE2026");
    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'student', ?, 'active', 1, ?, ?)
    `).run("usr-stud-01", "PRN2024001", "aarav.patil@student.mitaoe.ac.in", studentPasswordHash, "Aarav Patil", "Computer Engineering", now, now);

    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'student', ?, 'active', 1, ?, ?)
    `).run("usr-stud-02", "PRN2024002", "meera.joshi@student.mitaoe.ac.in", studentPasswordHash, "Meera Joshi", "Information Technology", now, now);

    db.prepare(`
      INSERT INTO users (id, prn, email, password_hash, full_name, role, department, account_status, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'student', ?, 'active', 1, ?, ?)
    `).run("usr-stud-03", "PRN2024003", "rohan.u@student.mitaoe.ac.in", studentPasswordHash, "Rohan Umbarepatil", "Mechanical Engineering", now, now);
  }

  const venueCount = db.prepare("SELECT COUNT(*) as count FROM venues").get().count;
  if (venueCount === 0) {
    const venues = [
      { id: "v1", name: "Main Auditorium", category: "Auditorium", capacity: 500, location: "Main Building", facilities: ["Projector", "Sound system", "Stage", "AC"], color: "lavender", description: "Central auditorium equipped for major symposiums, annual festivals, and convocations." },
      { id: "v2", name: "Seminar Hall A", category: "Seminar Hall", capacity: 120, location: "Academic Block", facilities: ["Projector", "Wi-Fi", "Microphone", "Podium"], color: "blue", description: "Tiered seating hall ideal for departmental lectures, guest seminars, and workshops." },
      { id: "v3", name: "Seminar Hall B", category: "Seminar Hall", capacity: 80, location: "Academic Block", facilities: ["Projector", "Wi-Fi", "Audio"], color: "mint", description: "Compact seminar space for student paper presentations and interactive seminars." },
      { id: "v4", name: "Conference Room", category: "Meeting Room", capacity: 24, location: "Administration Block", facilities: ["Display Screen", "Wi-Fi", "Video Conferencing"], color: "peach", description: "Executive conference suite with hybrid video conferencing and presentation display." },
      { id: "v5", name: "Innovation Room", category: "Event Room", capacity: 60, location: "Innovation Centre", facilities: ["Interactive Display", "Whiteboard", "Wi-Fi"], color: "pink", description: "Creative workspace designed for design thinking, hackathons, and ideation sessions." },
      { id: "v6", name: "Open Activity Space", category: "Common Space", capacity: 100, location: "Student Activity Area", facilities: ["Flexible seating", "Power outlets", "Acoustics"], color: "yellow", description: "Vibrant indoor commons for cultural rehearsals, club exhibits, and collaborative activities." }
    ];

    const insertVenue = db.prepare(`
      INSERT INTO venues (id, name, category, location, capacity, facilities, description, color, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    for (const v of venues) {
      insertVenue.run(v.id, v.name, v.category, v.location, v.capacity, JSON.stringify(v.facilities), v.description, v.color, now, now);
    }
  }

  const bookingCount = db.prepare("SELECT COUNT(*) as count FROM bookings").get().count;
  if (bookingCount === 0) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dateStr1 = tomorrow.toISOString().split("T")[0];

    const in3Days = new Date();
    in3Days.setDate(in3Days.getDate() + 3);
    const dateStr2 = in3Days.toISOString().split("T")[0];

    const in5Days = new Date();
    in5Days.setDate(in5Days.getDate() + 5);
    const dateStr3 = in5Days.toISOString().split("T")[0];

    // Seed realistic requests
    db.prepare(`
      INSERT INTO bookings (id, requester_id, venue_id, event_name, event_type, event_date, start_time, end_time, attendee_count, purpose, status, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "b1", "usr-stud-01", "v2", "Robotics Club Technical Workshop", "Club Meeting",
      dateStr1, "14:00", "15:30", 45,
      "Hands-on workshop demonstrating ROS2 navigation stacks on mobile robots for club members.",
      "pending", null, null, null, now, now
    );

    db.prepare(`
      INSERT INTO bookings (id, requester_id, venue_id, event_name, event_type, event_date, start_time, end_time, attendee_count, purpose, status, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "b2", "usr-teach-01", "v4", "Faculty Senate & Curriculum Review", "Academic",
      dateStr2, "10:00", "11:30", 18,
      "Quarterly faculty meeting to review curriculum updates and accreditation outcomes.",
      "approved", null, "usr-admin-01", now, now, now
    );

    db.prepare(`
      INSERT INTO bookings (id, requester_id, venue_id, event_name, event_type, event_date, start_time, end_time, attendee_count, purpose, status, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "b3", "usr-stud-02", "v5", "Design Thinking Bootcamp", "Workshop",
      dateStr3, "11:00", "13:00", 50,
      "Student hackathon preparation and brainstorming session.",
      "rejected", "Venue scheduled for routine equipment servicing on this date. Please choose Seminar Hall B or an alternate date.", "usr-admin-01", now, now, now
    );
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
    is_active: Boolean(r.is_active)
  }));
}

export function getVenueById(id) {
  const r = db.prepare("SELECT * FROM venues WHERE id = ?").get(id);
  if (!r) return null;
  return {
    ...r,
    facilities: JSON.parse(r.facilities || "[]"),
    is_active: Boolean(r.is_active)
  };
}

export function createVenue({ name, category, location, capacity, facilities = [], description = "", color = "lavender", is_active = 1 }) {
  const id = "v-" + crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO venues (id, name, category, location, capacity, facilities, description, color, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), category.trim(), location.trim(), Number(capacity), JSON.stringify(facilities), description.trim(), color, is_active ? 1 : 0, now, now);

  return getVenueById(id);
}

export function updateVenue(id, { name, category, location, capacity, facilities, description, color, is_active }) {
  const venue = getVenueById(id);
  if (!venue) throw new Error("Venue not found");

  const updatedName = name !== undefined ? name.trim() : venue.name;
  const updatedCategory = category !== undefined ? category.trim() : venue.category;
  const updatedLocation = location !== undefined ? location.trim() : venue.location;
  const updatedCapacity = capacity !== undefined ? Number(capacity) : venue.capacity;
  const updatedFacilities = facilities !== undefined ? JSON.stringify(facilities) : JSON.stringify(venue.facilities);
  const updatedDesc = description !== undefined ? description.trim() : venue.description;
  const updatedColor = color !== undefined ? color : venue.color;
  const updatedActive = is_active !== undefined ? (is_active ? 1 : 0) : (venue.is_active ? 1 : 0);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE venues
    SET name = ?, category = ?, location = ?, capacity = ?, facilities = ?, description = ?, color = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(updatedName, updatedCategory, updatedLocation, updatedCapacity, updatedFacilities, updatedDesc, updatedColor, updatedActive, now, id);

  return getVenueById(id);
}

// ----------------- BOOKING QUERIES -----------------

export function getBookingById(id) {
  const row = db.prepare(`
    SELECT b.*,
           v.name as venue_name, v.category as venue_category, v.location as venue_location, v.capacity as venue_capacity,
           u.full_name as requester_name, u.role as requester_role, u.prn as requester_prn, u.email as requester_email, u.department as requester_department,
           rev.full_name as reviewer_name
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    JOIN users u ON u.id = b.requester_id
    LEFT JOIN users rev ON rev.id = b.reviewed_by
    WHERE b.id = ?
  `).get(id);

  return row || null;
}

export function getBookings({ userId = null, role = null, status = null, venue_id = null, date_from = null, date_to = null, search = null } = {}) {
  let query = `
    SELECT b.*,
           v.name as venue_name, v.category as venue_category, v.location as venue_location, v.capacity as venue_capacity,
           u.full_name as requester_name, u.role as requester_role, u.prn as requester_prn, u.email as requester_email, u.department as requester_department,
           rev.full_name as reviewer_name
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    JOIN users u ON u.id = b.requester_id
    LEFT JOIN users rev ON rev.id = b.reviewed_by
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

  if (date_from) {
    query += " AND b.event_date >= ?";
    params.push(date_from);
  }

  if (date_to) {
    query += " AND b.event_date <= ?";
    params.push(date_to);
  }

  if (search) {
    query += " AND (b.event_name LIKE ? OR b.id LIKE ? OR u.full_name LIKE ? OR v.name LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  query += " ORDER BY b.created_at DESC";
  return db.prepare(query).all(...params);
}

export function createBooking({ requester_id, venue_id, event_name, event_type, event_date, start_time, end_time, attendee_count, purpose }) {
  const venue = getVenueById(venue_id);
  if (!venue) throw new Error("Venue does not exist");
  if (!venue.is_active) throw new Error("Venue is currently inactive and cannot accept bookings");

  const attendees = Number(attendee_count);
  if (isNaN(attendees) || attendees < 1) throw new Error("Attendee count must be at least 1");
  if (attendees > venue.capacity) {
    throw new Error(`Requested attendee count (${attendees}) exceeds venue maximum capacity (${venue.capacity})`);
  }

  if (start_time >= end_time) {
    throw new Error("Start time must be strictly earlier than end time");
  }

  // Check past date/time validation
  const startDateTime = new Date(`${event_date}T${start_time}`);
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
      AND b.event_date = ?
      AND b.status = 'approved'
      AND b.start_time < ?
      AND b.end_time > ?
  `).get(venue_id, event_date, end_time, start_time);

  if (conflict) {
    const err = new Error(`Time slot conflict: Venue is already booked for "${conflict.event_name}" (${conflict.start_time} - ${conflict.end_time})`);
    err.code = "CONFLICT";
    throw err;
  }

  const id = "b-" + crypto.randomUUID().substring(0, 8);
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO bookings (id, requester_id, venue_id, event_name, event_type, event_date, start_time, end_time, attendee_count, purpose, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, requester_id, venue_id, event_name.trim(), event_type.trim(), event_date, start_time, end_time, attendees, purpose.trim(), nowIso, nowIso);

  return getBookingById(id);
}

// ATOMIC APPROVAL WITH CONCURRENCY AND CONFLICT LOCKING
export function approveBooking({ bookingId, adminId, ipAddress = "127.0.0.1" }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
    if (!booking) {
      db.exec("ROLLBACK");
      throw new Error("Booking not found");
    }
    if (booking.status !== "pending") {
      db.exec("ROLLBACK");
      throw new Error(`Cannot approve booking that is currently ${booking.status}`);
    }

    const venue = getVenueById(booking.venue_id);
    if (!venue || !venue.is_active) {
      db.exec("ROLLBACK");
      throw new Error("Cannot approve booking: venue is currently inactive");
    }

    // Check for any overlapping APPROVED booking
    const conflict = db.prepare(`
      SELECT b.id, b.event_name, b.start_time, b.end_time, u.full_name as requester_name
      FROM bookings b
      JOIN users u ON u.id = b.requester_id
      WHERE b.venue_id = ?
        AND b.event_date = ?
        AND b.status = 'approved'
        AND b.id != ?
        AND b.start_time < ?
        AND b.end_time > ?
    `).get(booking.venue_id, booking.event_date, booking.id, booking.end_time, booking.start_time);

    if (conflict) {
      db.exec("ROLLBACK");
      const err = new Error(`Approval blocked by booking conflict: "${conflict.event_name}" (${conflict.start_time} - ${conflict.end_time}) by ${conflict.requester_name} is already confirmed for this venue slot`);
      err.code = "CONFLICT";
      throw err;
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE bookings
      SET status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(adminId, now, now, bookingId);

    // Audit log
    const logId = "log-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'APPROVE_BOOKING', 'booking', ?, ?, ?, ?)
    `).run(logId, adminId, bookingId, JSON.stringify({
      venue_id: booking.venue_id,
      venue_name: venue.name,
      event_name: booking.event_name,
      event_date: booking.event_date,
      start_time: booking.start_time,
      end_time: booking.end_time
    }), ipAddress, now);

    // In-app notification
    const notifId = "notif-" + crypto.randomUUID();
    db.prepare(`
      INSERT INTO notifications (id, user_id, booking_id, title, message, created_at)
      VALUES (?, ?, ?, 'Booking Approved', ?, ?)
    `).run(
      notifId,
      booking.requester_id,
      bookingId,
      `Your booking request for "${booking.event_name}" at ${venue.name} on ${booking.event_date} (${booking.start_time} - ${booking.end_time}) has been APPROVED.`,
      now
    );

    db.exec("COMMIT");
    return getBookingById(bookingId);
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
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
      SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(reason.trim(), adminId, now, now, bookingId);

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
