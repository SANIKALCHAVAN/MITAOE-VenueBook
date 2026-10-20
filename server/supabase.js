import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { generateApprovalPdf, DOCUMENTS_DIR, sanitizeFilename } from "./documentGenerator.js";

// Load environment variables with override so local .env takes precedence
dotenv.config({ override: true });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  !SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
  ((SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) ||
   (SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_SERVICE_ROLE_KEY.includes("YOUR_SUPABASE")))
);

// Anonymous Client (client permissions)
export const supabaseClient = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// Service Role Client (trusted server-side operations: token verification, admin RPCs)
export const supabaseAdmin = isSupabaseConfigured && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : supabaseClient;

let _isOnline = null;
let _lastChecked = 0;

export async function isSupabaseOnline() {
  if (!isSupabaseConfigured || !SUPABASE_URL) return false;
  if (process.env.NODE_ENV === "test" && process.env.TEST_WITH_LIVE_SUPABASE !== "true") {
    return false;
  }
  const now = Date.now();
  if (_isOnline !== null && now - _lastChecked < 15000) {
    return _isOnline;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const key = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: key ? { apikey: key } : {},
      signal: controller.signal
    });
    clearTimeout(timeout);
    _isOnline = res.ok || (res.status >= 200 && res.status < 500);
  } catch {
    _isOnline = false;
  }
  _lastChecked = now;
  return _isOnline;
}

/**
 * Verify whether required PostgreSQL database tables exist in Supabase.
 */
export async function checkSupabaseSchema() {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return { ok: false, initialized: false, error: "Supabase credentials not configured." };
  }
  try {
    const { error } = await supabaseAdmin.from("venues").select("id").limit(1);
    if (error) {
      if (error.message && error.message.includes("Could not find the table")) {
        return {
          ok: false,
          initialized: false,
          error: "Database schema not initialized. Table 'public.venues' does not exist in Supabase. Please run supabase/schema.sql in your Supabase Dashboard SQL Editor."
        };
      }
      return { ok: false, initialized: false, error: error.message };
    }
    return { ok: true, initialized: true };
  } catch (err) {
    return { ok: false, initialized: false, error: err.message };
  }
}

/**
 * Verify a Supabase Auth access token and retrieve the user's verified role and profile from PostgreSQL.
 */
export async function verifySupabaseToken(accessToken) {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;
  if (!accessToken || typeof accessToken !== "string") return null;

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !user) return null;

    // Resolve profile and server-verified role from database
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, prn, email, full_name, role, department, account_status, email_verified")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !profile || profile.account_status !== "active") {
      return null;
    }

    return {
      id: profile.id,
      prn: profile.prn,
      email: profile.email || user.email,
      full_name: profile.full_name,
      role: profile.role,
      department: profile.department,
      account_status: profile.account_status,
      email_verified: profile.email_verified
    };
  } catch (err) {
    console.error("Token verification error:", err.message);
    return null;
  }
}

/**
 * Student Login: Resolves PRN to registered Supabase Auth account.
 */
export async function loginStudentSupabase(prn, password) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured in environment");

  const cleanPrn = prn.trim().toUpperCase();

  // 1. Look up student profile by PRN in PostgreSQL
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, email, prn, role, full_name, department, account_status")
    .ilike("prn", cleanPrn)
    .maybeSingle();

  if (profileErr) {
    if (profileErr.message && profileErr.message.includes("Could not find the table")) {
      const err = new Error("Supabase database schema is not initialized. Table 'public.profiles' does not exist. Please run supabase/schema.sql in your Supabase Dashboard SQL Editor.");
      err.status = 503;
      throw err;
    }
    const err = new Error(`Database error looking up PRN: ${profileErr.message}`);
    err.status = 500;
    throw err;
  }

  if (!profile) {
    const err = new Error(`PRN "${cleanPrn}" is not registered in the student roster.`);
    err.status = 401;
    throw err;
  }

  if (profile.role !== "student") {
    const err = new Error("This portal is strictly for authorized students.");
    err.status = 403;
    throw err;
  }

  if (profile.account_status !== "active") {
    const err = new Error("Student account is inactive. Contact campus administration.");
    err.status = 403;
    throw err;
  }

  // 2. Authenticate against Supabase Auth using the mapped email
  const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({
    email: profile.email,
    password
  });

  if (authErr) {
    const err = new Error("Invalid PRN or password. Please verify your credentials.");
    err.status = 401;
    throw err;
  }

  return {
    session: authData.session,
    token: authData.session.access_token,
    user: profile
  };
}

/**
 * Teacher Login: Verifies assigned college email with Supabase Auth.
 */
export async function loginTeacherSupabase(email, password) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured in environment");

  const cleanEmail = email.trim().toLowerCase();

  // 1. Verify profile role in PostgreSQL
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, email, role, full_name, department, account_status, email_verified")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (profileErr) {
    if (profileErr.message && profileErr.message.includes("Could not find the table")) {
      const err = new Error("Supabase database schema is not initialized. Table 'public.profiles' does not exist. Please run supabase/schema.sql in your Supabase Dashboard SQL Editor.");
      err.status = 503;
      throw err;
    }
    const err = new Error(`Database error looking up faculty: ${profileErr.message}`);
    err.status = 500;
    throw err;
  }

  if (!profile) {
    const err = new Error(`Email "${cleanEmail}" is not authorized for faculty access.`);
    err.status = 401;
    throw err;
  }

  if (profile.role !== "teacher") {
    const err = new Error("This portal is strictly for authorized teachers and faculty members.");
    err.status = 403;
    throw err;
  }

  if (profile.account_status !== "active") {
    const err = new Error("Teacher account is inactive.");
    err.status = 403;
    throw err;
  }

  // 2. Authenticate with Supabase Auth
  const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({
    email: cleanEmail,
    password
  });

  if (authErr) {
    const err = new Error("Invalid faculty credentials.");
    err.status = 401;
    throw err;
  }

  return {
    session: authData.session,
    token: authData.session.access_token,
    user: profile
  };
}

/**
 * Admin Login: Dedicated administrator gateway with role check.
 */
export async function loginAdminSupabase(email, password) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured in environment");

  const cleanEmail = email.trim().toLowerCase();

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, email, role, full_name, department, account_status")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (profileErr) {
    if (profileErr.message && profileErr.message.includes("Could not find the table")) {
      const err = new Error("Supabase database schema is not initialized. Table 'public.profiles' does not exist. Please run supabase/schema.sql in your Supabase Dashboard SQL Editor.");
      err.status = 503;
      throw err;
    }
    const err = new Error(`Database error looking up admin: ${profileErr.message}`);
    err.status = 500;
    throw err;
  }

  if (!profile || profile.role !== "admin") {
    const err = new Error("Administrator authorization failed. Invalid credentials or insufficient privileges.");
    err.status = 401;
    throw err;
  }

  const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({
    email: cleanEmail,
    password
  });

  if (authErr) {
    const err = new Error("Invalid administrator credentials.");
    err.status = 401;
    throw err;
  }

  return {
    session: authData.session,
    token: authData.session.access_token,
    user: profile
  };
}

/**
 * Venues: Read from Supabase PostgreSQL.
 */
export async function getVenuesSupabase(includeInactive = false) {
  let query = supabaseAdmin.from("venues").select("*").order("name", { ascending: true });
  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load venues: ${error.message}`);
  return (data || []).map((v) => ({
    ...v,
    category: v.venue_type,
    facilities: Array.isArray(v.facilities) ? v.facilities : []
  }));
}

/**
 * Venues: Create via Supabase.
 */
export async function createVenueSupabase(venueData) {
  const payload = {
    name: venueData.name.trim(),
    venue_type: venueData.category.trim(),
    location: venueData.location.trim(),
    capacity: Number(venueData.capacity),
    facilities: Array.isArray(venueData.facilities) ? venueData.facilities : [],
    description: venueData.description || "",
    color: venueData.color || "lavender",
    is_active: venueData.is_active ?? true
  };

  const { data, error } = await supabaseAdmin.from("venues").insert(payload).select().single();
  if (error) throw new Error(`Could not create venue: ${error.message}`);
  return { ...data, category: data.venue_type };
}

/**
 * Venues: Update via Supabase.
 */
export async function updateVenueSupabase(id, venueData) {
  const payload = {};
  if (venueData.name !== undefined) payload.name = venueData.name.trim();
  if (venueData.category !== undefined) payload.venue_type = venueData.category.trim();
  if (venueData.location !== undefined) payload.location = venueData.location.trim();
  if (venueData.capacity !== undefined) payload.capacity = Number(venueData.capacity);
  if (venueData.facilities !== undefined) payload.facilities = venueData.facilities;
  if (venueData.description !== undefined) payload.description = venueData.description;
  if (venueData.color !== undefined) payload.color = venueData.color;
  if (venueData.is_active !== undefined) payload.is_active = Boolean(venueData.is_active);
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from("venues").update(payload).eq("id", id).select().single();
  if (error) throw new Error(`Could not update venue: ${error.message}`);
  return { ...data, category: data.venue_type };
}

/**
 * Retrieve single booking by ID from Supabase with full relational joins
 */
export async function getBookingByIdSupabase(bookingId) {
  if (!isSupabaseConfigured) return null;

  try {
    const { data: b, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        *,
        venues:venue_id (id, name, venue_type, location, capacity, facilities),
        profiles:requester_id (id, full_name, role, prn, email, department),
        reviewer:reviewed_by (id, full_name)
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (error || !b) return null;

    let doc = null;
    try {
      const { data: docData } = await supabaseAdmin
        .from("booking_documents")
        .select("*")
        .eq("booking_id", bookingId)
        .eq("document_type", "approval_summary")
        .maybeSingle();
      doc = docData || null;
    } catch {}

    const safeId = sanitizeFilename(b.id);
    const localFileName = `VenueBook_Approval_${safeId}.pdf`;
    const localFilePath = path.join(DOCUMENTS_DIR, localFileName);

    if (!doc && fs.existsSync(localFilePath)) {
      const stat = fs.statSync(localFilePath);
      doc = {
        id: "doc-" + safeId,
        booking_id: b.id,
        document_reference: `DOC-MIT-${safeId.substring(0, 8).toUpperCase()}`,
        approval_reference: `APP-MIT-${safeId.substring(0, 8).toUpperCase()}`,
        document_type: "approval_summary",
        file_path: localFilePath,
        file_name: localFileName,
        file_size: stat.size,
        mime_type: "application/pdf",
        generation_status: "ready",
        generated_at: stat.mtime.toISOString(),
        error_message: null
      };
    }

    let cleanPurpose = b.purpose || "";
    let extractedEndDate = b.end_date || b.event_date;
    if (cleanPurpose.startsWith("[End Date: ")) {
      const match = cleanPurpose.match(/^\[End Date:\s*([^\]]+)\]\n?/);
      if (match) {
        extractedEndDate = match[1].trim();
        cleanPurpose = cleanPurpose.replace(/^\[End Date:\s*[^\]]+\]\n?/, "");
      }
    }

    let facilities = [];
    if (b.venues?.facilities) {
      facilities = typeof b.venues.facilities === "string" ? JSON.parse(b.venues.facilities) : b.venues.facilities;
    }

    return {
      id: b.id,
      venue_id: b.venue_id,
      venue_name: b.venues?.name || "Campus Venue",
      venue_category: b.venues?.venue_type || "Facility",
      venue_location: b.venues?.location || "Campus",
      venue_capacity: b.venues?.capacity || 0,
      facilities,
      requester_id: b.requester_id,
      requester_name: b.profiles?.full_name || "Campus User",
      requester_role: b.profiles?.role || "student",
      requester_prn: b.profiles?.prn || "",
      requester_email: b.profiles?.email || "",
      requester_department: b.profiles?.department || "",
      event_name: b.event_title,
      event_type: b.event_type,
      event_date: b.event_date,
      start_date: b.event_date,
      end_date: extractedEndDate,
      start_time: b.start_time,
      end_time: b.end_time,
      attendee_count: b.expected_attendees,
      purpose: cleanPurpose,
      status: b.status,
      rejection_reason: b.rejection_reason,
      reviewed_by: b.reviewed_by,
      reviewer_name: b.reviewer?.full_name || "Campus Administrator",
      reviewed_at: b.reviewed_at,
      created_at: b.created_at,
      updated_at: b.updated_at,
      document: doc
    };
  } catch (err) {
    console.error("Error in getBookingByIdSupabase:", err.message);
    return null;
  }
}

/**
 * Bookings: Retrieve from Supabase with joins and data isolation.
 */
export async function getBookingsSupabase({ userId, role, status, venue_id, date_from, date_to, search }) {
  let query = supabaseAdmin
    .from("bookings")
    .select(`
      *,
      venues:venue_id (id, name, venue_type, location, capacity),
      profiles:requester_id (id, full_name, role, prn, email, department),
      reviewer:reviewed_by (id, full_name)
    `)
    .order("created_at", { ascending: false });

  // Data isolation
  if (role !== "admin") {
    query = query.eq("requester_id", userId);
  }

  if (status && status !== "all") query = query.eq("status", status);
  if (venue_id && venue_id !== "all") query = query.eq("venue_id", venue_id);
  if (date_from) query = query.gte("event_date", date_from);
  if (date_to) query = query.lte("event_date", date_to);
  if (search) {
    query = query.or(`event_title.ilike.%${search}%,id.eq.${search}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not retrieve bookings: ${error.message}`);

  // Fetch associated documents if booking_documents table exists
  let docMap = {};
  try {
    const bookingIds = (data || []).map((b) => b.id);
    if (bookingIds.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from("booking_documents")
        .select("*")
        .in("booking_id", bookingIds)
        .eq("document_type", "approval_summary");
      if (docs) {
        for (const doc of docs) {
          docMap[doc.booking_id] = doc;
        }
      }
    }
  } catch {
    // If table doesn't exist yet, continue gracefully
  }

  return (data || []).map((b) => {
    let cleanPurpose = b.purpose || "";
    let extractedEndDate = b.end_date || b.event_date;
    if (cleanPurpose.startsWith("[End Date: ")) {
      const match = cleanPurpose.match(/^\[End Date:\s*([^\]]+)\]\n?/);
      if (match) {
        extractedEndDate = match[1].trim();
        cleanPurpose = cleanPurpose.replace(/^\[End Date:\s*[^\]]+\]\n?/, "");
      }
    }

    let existingDoc = docMap[b.id] || null;
    if (!existingDoc && b.status === "approved") {
      const safeId = sanitizeFilename(b.id);
      const localFilePath = path.join(DOCUMENTS_DIR, `VenueBook_Approval_${safeId}.pdf`);
      if (fs.existsSync(localFilePath)) {
        const stat = fs.statSync(localFilePath);
        existingDoc = {
          id: "doc-" + safeId,
          booking_id: b.id,
          document_reference: `DOC-MIT-${safeId.substring(0, 8).toUpperCase()}`,
          approval_reference: `APP-MIT-${safeId.substring(0, 8).toUpperCase()}`,
          generation_status: "ready",
          generated_at: stat.mtime.toISOString(),
          file_name: `VenueBook_Approval_${safeId}.pdf`,
          file_size: stat.size,
          error_message: null
        };
      }
    }

    return {
      id: b.id,
      venue_id: b.venue_id,
      venue_name: b.venues?.name || "Campus Venue",
      venue_category: b.venues?.venue_type || "Facility",
      venue_location: b.venues?.location || "Campus",
      venue_capacity: b.venues?.capacity || 0,
      requester_id: b.requester_id,
      requester_name: b.profiles?.full_name || "Campus User",
      requester_role: b.profiles?.role || "student",
      requester_prn: b.profiles?.prn || "",
      requester_email: b.profiles?.email || "",
      requester_department: b.profiles?.department || "",
      event_name: b.event_title,
      event_type: b.event_type,
      event_date: b.event_date,
      start_date: b.event_date,
      end_date: extractedEndDate,
      start_time: b.start_time,
      end_time: b.end_time,
      attendee_count: b.expected_attendees,
      purpose: cleanPurpose,
      status: b.status,
      rejection_reason: b.rejection_reason,
      reviewer_name: b.reviewer?.full_name || "",
      reviewed_at: b.reviewed_at,
      created_at: b.created_at,
      document: existingDoc ? {
        id: existingDoc.id,
        booking_id: b.id,
        document_reference: existingDoc.document_reference,
        approval_reference: existingDoc.approval_reference,
        generation_status: existingDoc.generation_status,
        generated_at: existingDoc.generated_at,
        file_name: existingDoc.file_name,
        file_size: existingDoc.file_size,
        error_message: existingDoc.error_message
      } : null
    };
  });
}

/**
 * Bookings: Create booking in Supabase with validation.
 */
export async function createBookingSupabase({ requester_id, venue_id, event_name, event_type, start_date, end_date, event_date, start_time, end_time, attendee_count, purpose }) {
  const startDate = start_date || event_date;
  const endDate = end_date || startDate;

  if (endDate < startDate) {
    throw new Error("Ending date cannot be earlier than starting date");
  }

  // Validate venue and capacity
  const { data: venue, error: venueErr } = await supabaseAdmin.from("venues").select("*").eq("id", venue_id).single();
  if (venueErr || !venue) throw new Error("Venue does not exist");
  if (!venue.is_active) throw new Error("Venue is inactive and cannot accept bookings");

  const attendees = Number(attendee_count);
  if (attendees < 1) throw new Error("Attendee count must be at least 1");
  if (attendees > venue.capacity) {
    throw new Error(`Attendee count (${attendees}) exceeds maximum venue capacity (${venue.capacity})`);
  }

  if (startDate === endDate && start_time >= end_time) {
    throw new Error("Start time must be strictly earlier than end time");
  }

  // Pre-check for conflicting approved bookings
  const { data: conflicts } = await supabaseAdmin
    .from("bookings")
    .select("id, event_title, start_time, end_time")
    .eq("venue_id", venue_id)
    .eq("event_date", startDate)
    .eq("status", "approved")
    .lt("start_time", end_time)
    .gt("end_time", start_time);

  if (conflicts && conflicts.length > 0) {
    const err = new Error(`Time slot conflict: Venue is already booked for "${conflicts[0].event_title}" (${conflicts[0].start_time} - ${conflicts[0].end_time})`);
    err.code = "CONFLICT";
    err.status = 409;
    throw err;
  }

  let finalPurpose = purpose.trim();
  if (endDate && endDate !== startDate) {
    finalPurpose = `[End Date: ${endDate}]\n${finalPurpose}`;
  }

  const payload = {
    venue_id,
    requester_id,
    event_title: event_name.trim(),
    event_type: event_type || "Academic",
    event_date: startDate,
    start_time,
    end_time,
    expected_attendees: attendees,
    purpose: finalPurpose,
    status: "pending"
  };

  const { data, error } = await supabaseAdmin.from("bookings").insert(payload).select().single();
  if (error) {
    const err = new Error(`Failed to create booking: ${error.message}`);
    if (error.message.includes("no_overlapping_approved_venue_bookings")) {
      err.code = "CONFLICT";
      err.status = 409;
    }
    throw err;
  }

  return {
    ...data,
    event_name: data.event_title,
    start_date: data.event_date,
    end_date: endDate,
    attendee_count: data.expected_attendees,
    purpose: purpose.trim()
  };
}

/**
 * Bookings: Atomic approval RPC via PostgreSQL function + Automatic Document Generation.
 */
export async function approveBookingSupabase({ bookingId, adminId }) {
  // 1. Idempotency check: if booking is already approved, retrieve existing document and return
  const existingBooking = await getBookingByIdSupabase(bookingId);

  if (existingBooking && existingBooking.status === "approved") {
    let doc = await getBookingDocumentSupabase(bookingId);
    if (!doc || doc.generation_status === "failed") {
      try {
        const retryRes = await retryGenerateBookingDocumentSupabase({ bookingId, adminId });
        doc = retryRes.document;
      } catch {}
    }
    return { booking: existingBooking, document: doc, isExisting: true };
  }

  const { data, error } = await supabaseAdmin.rpc("approve_booking_atomic", {
    p_booking_id: bookingId,
    p_admin_id: adminId
  });

  if (error) {
    const err = new Error(error.message);
    if (error.message.includes("conflict") || error.message.includes("exclusion")) {
      err.code = "CONFLICT";
      err.status = 409;
    }
    throw err;
  }

  // Fetch fully hydrated booking record directly by ID
  const hydratedBooking = await getBookingByIdSupabase(bookingId);

  let docRecord = null;
  const docRef = `DOC-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const appRef = `APP-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  if (hydratedBooking) {
    try {
      const pdfResult = await generateApprovalPdf(hydratedBooking, {
        documentReference: docRef,
        approvalReference: appRef
      });

      docRecord = {
        id: "doc-" + bookingId,
        booking_id: bookingId,
        document_reference: docRef,
        approval_reference: appRef,
        document_type: "approval_summary",
        file_path: pdfResult.filePath,
        file_name: pdfResult.fileName,
        file_size: pdfResult.fileSize,
        mime_type: "application/pdf",
        generation_status: "ready",
        generated_at: new Date().toISOString(),
        generated_by: adminId,
        error_message: null
      };

      try {
        const { data: savedDoc } = await supabaseAdmin
          .from("booking_documents")
          .upsert(docRecord, { onConflict: "booking_id, document_type" })
          .select()
          .maybeSingle();

        if (savedDoc) docRecord = savedDoc;
      } catch {
        // Continue with local docRecord if table not yet migrated in Supabase
      }
    } catch (pdfErr) {
      console.error("PDF generation failed in Supabase flow:", pdfErr.message);
      docRecord = {
        id: "doc-" + bookingId,
        booking_id: bookingId,
        document_reference: docRef,
        approval_reference: appRef,
        document_type: "approval_summary",
        file_path: "",
        file_name: "",
        file_size: 0,
        mime_type: "application/pdf",
        generation_status: "failed",
        generated_by: adminId,
        error_message: pdfErr.message
      };

      try {
        await supabaseAdmin
          .from("booking_documents")
          .upsert(docRecord, { onConflict: "booking_id, document_type" });
      } catch {}
    }
  }

  const finalHydrated = (await getBookingByIdSupabase(bookingId)) || hydratedBooking;
  return { booking: finalHydrated, document: docRecord, isExisting: false };
}

export async function getBookingDocumentSupabase(bookingId) {
  try {
    const { data } = await supabaseAdmin
      .from("booking_documents")
      .select("*")
      .eq("booking_id", bookingId)
      .eq("document_type", "approval_summary")
      .maybeSingle();
    if (data) return data;
  } catch {}

  const safeId = sanitizeFilename(bookingId);
  const localFileName = `VenueBook_Approval_${safeId}.pdf`;
  const localFilePath = path.join(DOCUMENTS_DIR, localFileName);
  if (fs.existsSync(localFilePath)) {
    const stat = fs.statSync(localFilePath);
    return {
      id: "doc-" + safeId,
      booking_id: bookingId,
      document_reference: `DOC-MIT-${safeId.substring(0, 8).toUpperCase()}`,
      approval_reference: `APP-MIT-${safeId.substring(0, 8).toUpperCase()}`,
      document_type: "approval_summary",
      file_path: localFilePath,
      file_name: localFileName,
      file_size: stat.size,
      mime_type: "application/pdf",
      generation_status: "ready",
      generated_at: stat.mtime.toISOString(),
      error_message: null
    };
  }

  return null;
}

export async function retryGenerateBookingDocumentSupabase({ bookingId, adminId }) {
  const hydratedBooking = await getBookingByIdSupabase(bookingId);
  if (!hydratedBooking) throw new Error("Booking not found");
  if (hydratedBooking.status !== "approved") {
    throw new Error(`Cannot generate approval document for a booking that is ${hydratedBooking.status}`);
  }

  const existingDoc = await getBookingDocumentSupabase(bookingId);
  const docRef = existingDoc?.document_reference || `DOC-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const appRef = existingDoc?.approval_reference || `APP-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  try {
    const pdfResult = await generateApprovalPdf(hydratedBooking, {
      documentReference: docRef,
      approvalReference: appRef
    });

    const docRecord = {
      id: existingDoc?.id || "doc-" + bookingId,
      booking_id: bookingId,
      document_reference: docRef,
      approval_reference: appRef,
      document_type: "approval_summary",
      file_path: pdfResult.filePath,
      file_name: pdfResult.fileName,
      file_size: pdfResult.fileSize,
      mime_type: "application/pdf",
      generation_status: "ready",
      generated_at: new Date().toISOString(),
      generated_by: adminId,
      error_message: null
    };

    try {
      const { data: savedDoc } = await supabaseAdmin
        .from("booking_documents")
        .upsert(docRecord, { onConflict: "booking_id, document_type" })
        .select()
        .maybeSingle();

      if (savedDoc) Object.assign(docRecord, savedDoc);
    } catch {}

    return {
      booking: await getBookingByIdSupabase(bookingId),
      document: docRecord,
      message: "Approval document generated successfully"
    };
  } catch (err) {
    throw new Error(`Failed to generate document: ${err.message}`);
  }
}

/**
 * Bookings: Atomic rejection RPC via PostgreSQL function.
 */
export async function rejectBookingSupabase({ bookingId, adminId, reason }) {
  if (!reason || !reason.trim()) {
    throw new Error("A clear rejection reason is mandatory when declining a booking request");
  }

  const { data, error } = await supabaseAdmin.rpc("reject_booking_atomic", {
    p_booking_id: bookingId,
    p_reason: reason.trim(),
    p_admin_id: adminId
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Bookings: Cancellation RPC.
 */
export async function cancelBookingSupabase({ bookingId, userId }) {
  const { data, error } = await supabaseAdmin.rpc("cancel_booking_user", {
    p_booking_id: bookingId,
    p_user_id: userId
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Dashboard Stats: Aggregated from Supabase PostgreSQL.
 */
export async function getStatsSupabase() {
  const [bRes, pRes, aRes, rRes, vRes] = await Promise.all([
    supabaseAdmin.from("bookings").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("bookings").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabaseAdmin.from("bookings").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabaseAdmin.from("bookings").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    supabaseAdmin.from("venues").select("*", { count: "exact", head: true }).eq("is_active", true)
  ]);

  const today = new Date().toISOString().split("T")[0];
  const { count: upcoming } = await supabaseAdmin
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", "approved")
    .gte("event_date", today);

  return {
    totalRequests: bRes.count || 0,
    pendingRequests: pRes.count || 0,
    approvedBookings: aRes.count || 0,
    rejectedRequests: rRes.count || 0,
    activeVenues: vRes.count || 0,
    upcomingApproved: upcoming || 0
  };
}

/**
 * Audit Logs: Read from Supabase.
 */
export async function getAuditLogsSupabase(limit = 50) {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select(`
      *,
      actor:actor_id (full_name, role, email)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []).map((l) => ({
    id: l.id,
    action: l.action,
    actor_name: l.actor?.full_name || "Administrator",
    actor_email: l.actor?.email || "",
    actor_role: l.actor?.role || "admin",
    entity_type: l.entity_type,
    entity_id: l.entity_id,
    details: typeof l.details === "object" ? JSON.stringify(l.details) : l.details,
    created_at: l.created_at
  }));
}

/**
 * Users: Read roster from Supabase.
 */
export async function getUsersSupabase({ role, search } = {}) {
  let query = supabaseAdmin.from("profiles").select("*").order("created_at", { ascending: false });
  if (role) query = query.eq("role", role);
  if (search) query = query.ilike("full_name", `%${search}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Users: Provision new student or teacher account in Supabase Auth & PostgreSQL.
 */
export async function provisionUserSupabase({ full_name, role, prn, email, password, department }) {
  if (role === "student" && !prn) throw new Error("PRN is strictly required for student accounts");
  if ((role === "teacher" || role === "admin") && !email) throw new Error("Email is required for teacher and admin accounts");

  const cleanEmail = email ? email.trim().toLowerCase() : `${prn.toLowerCase()}@student.mitaoe.ac.in`;
  const cleanPrn = prn ? prn.trim().toUpperCase() : null;

  // 1. Create auth user in Supabase Auth
  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: full_name.trim(),
      role,
      prn: cleanPrn,
      department: department?.trim()
    }
  });

  if (authErr) throw new Error(`Supabase Auth creation failed: ${authErr.message}`);

  // 2. Upsert profile in PostgreSQL
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .upsert({
      id: authUser.user.id,
      prn: cleanPrn,
      email: cleanEmail,
      full_name: full_name.trim(),
      role,
      department: department?.trim(),
      account_status: "active",
      email_verified: true
    })
    .select()
    .single();

  if (profileErr) throw new Error(`Profile creation failed: ${profileErr.message}`);
  return profile;
}

/**
 * Notifications: Read and mark read from Supabase.
 */
export async function getNotificationsSupabase(userId) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);
  return data || [];
}

export async function markNotificationsReadSupabase(userId) {
  await supabaseAdmin
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId);
}
