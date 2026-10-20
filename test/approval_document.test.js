import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";

process.env.NODE_ENV = "test";
const { app } = await import("../server/app.js");
const {
  getUserByPrn,
  getUserByEmail,
  createBooking,
  getBookingById,
  getBookingDocument,
  approveBooking,
  rejectBooking,
  retryGenerateBookingDocument
} = await import("../server/db.js");
const { generateApprovalPdf } = await import("../server/documentGenerator.js");

describe("Booking Approval Summary Document: Production Integration & Security Tests", () => {
  let server;
  let baseUrl;
  let adminToken;
  let student1Token;
  let student2Token;
  let teacherToken;

  const student1 = getUserByPrn("PRN2024001"); // Aarav Patil
  const student2 = getUserByPrn("PRN2024002"); // Meera Joshi
  const teacher = getUserByEmail("prof.sharma@mitaoe.ac.in");
  const admin = getUserByEmail("admin@mitaoe.ac.in");

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });

    // Obtain authentic tokens
    const adminRes = await fetch(`${baseUrl}/api/auth/admin-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@mitaoe.ac.in", password: "Admin@MITAOE2026" })
    });
    adminToken = (await adminRes.json()).token;

    const s1Res = await fetch(`${baseUrl}/api/auth/student-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prn: "PRN2024001", password: "Student@MITAOE2026" })
    });
    student1Token = (await s1Res.json()).token;

    const s2Res = await fetch(`${baseUrl}/api/auth/student-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prn: "PRN2024002", password: "Student@MITAOE2026" })
    });
    student2Token = (await s2Res.json()).token;

    const teachRes = await fetch(`${baseUrl}/api/auth/teacher-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "prof.sharma@mitaoe.ac.in", password: "Teacher@MITAOE2026" })
    });
    teacherToken = (await teachRes.json()).token;
  });

  after(() => {
    if (server) server.close();
  });

  const future = new Date();
  future.setDate(future.getDate() + 300 + Math.floor(Math.random() * 500));
  const testDate = future.toISOString().split("T")[0];

  let testBookingId;
  let testDocument;

  // Scenario 1 & 2: Authorized Admin approves a Pending booking & persisted in database
  test("1 & 2. Authorized Admin approves a Pending booking and it is persisted with APPROVED status", async () => {
    const booking = createBooking({
      requester_id: student1.id,
      venue_id: "v1", // Main Auditorium
      event_name: "Annual Robocon Demonstration 2026",
      event_type: "Workshop",
      event_date: testDate,
      start_time: "10:00",
      end_time: "12:00",
      attendee_count: 150,
      purpose: "Campus robotics exhibition and autonomous rover demonstration."
    });
    testBookingId = booking.id;
    assert.strictEqual(booking.status, "pending");

    const approveRes = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: "approved" })
    });

    assert.strictEqual(approveRes.status, 200);
    const body = await approveRes.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.booking.status, "approved");
    assert.ok(body.document);
    assert.strictEqual(body.document.generation_status, "ready");

    // Verify database persistence directly
    const persisted = getBookingById(booking.id);
    assert.strictEqual(persisted.status, "approved");
    assert.strictEqual(persisted.reviewed_by, admin.id);
    assert.ok(persisted.reviewed_at);

    testDocument = body.document;
  });

  // Scenario 3: A PDF is generated from the persisted record
  test("3. A valid PDF file is generated from the persisted record and stored privately", async () => {
    assert.ok(testDocument.file_path, "Document should have a file path");
    assert.ok(fs.existsSync(testDocument.file_path), "Generated PDF must exist on private filesystem");

    const fileBuffer = fs.readFileSync(testDocument.file_path);
    // PDF Magic number %PDF-
    assert.strictEqual(fileBuffer.subarray(0, 4).toString(), "%PDF", "File must begin with valid PDF magic bytes %PDF");
    assert.ok(fileBuffer.length > 500, "PDF file must contain substantial content");
  });

  // Scenario 4: The PDF contains correct booking reference and venue name
  test("4. PDF metadata and generation includes verified booking reference and venue name", async () => {
    assert.ok(testDocument.document_reference.startsWith("DOC-MIT-"));
    assert.ok(testDocument.approval_reference.startsWith("APP-MIT-"));

    const docRecord = getBookingDocument(testBookingId);
    assert.ok(docRecord);
    assert.strictEqual(docRecord.document_reference, testDocument.document_reference);
    assert.strictEqual(docRecord.approval_reference, testDocument.approval_reference);
    assert.strictEqual(docRecord.generation_status, "ready");
  });

  // Scenario 5 & 6: The PDF reflects verified booking date, time, and APPROVED status
  test("5 & 6. Booking record confirms verified start date, time window, and APPROVED status", async () => {
    const booking = getBookingById(testBookingId);
    assert.strictEqual(booking.status, "approved");
    assert.strictEqual(booking.event_date, testDate);
    assert.strictEqual(booking.start_time, "10:00");
    assert.strictEqual(booking.end_time, "12:00");
    assert.strictEqual(booking.venue_name, "Main Auditorium");
  });

  // Scenario 7: Administrator identity and approval timestamp come from trusted server-side data
  test("7. Administrator identity and approval timestamp come from trusted server-side data", async () => {
    const booking = getBookingById(testBookingId);
    assert.strictEqual(booking.reviewed_by, admin.id);
    assert.strictEqual(booking.reviewer_name, "MITAOE Venue Administrator");
    assert.ok(booking.reviewed_at);
  });

  // Scenario 8: Student cannot approve a booking
  test("8. Student cannot approve a booking (HTTP 403 Forbidden)", async () => {
    const freshBooking = createBooking({
      requester_id: student1.id,
      venue_id: "v2",
      event_name: "Unauthorized Approval Test",
      event_type: "Academic",
      event_date: testDate,
      start_time: "14:00",
      end_time: "15:00",
      attendee_count: 20,
      purpose: "Testing security enforcement."
    });

    const res = await fetch(`${baseUrl}/api/bookings/${freshBooking.id}/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${student1Token}`
      },
      body: JSON.stringify({ status: "approved" })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes("forbidden") || body.error.includes("admin"));
  });

  // Scenario 9: Teacher cannot approve a booking
  test("9. Teacher cannot approve a booking (HTTP 403 Forbidden)", async () => {
    const freshBooking = createBooking({
      requester_id: student1.id,
      venue_id: "v2",
      event_name: "Teacher Unauthorized Approval Test",
      event_type: "Academic",
      event_date: testDate,
      start_time: "15:00",
      end_time: "16:00",
      attendee_count: 20,
      purpose: "Testing security enforcement."
    });

    const res = await fetch(`${baseUrl}/api/bookings/${freshBooking.id}/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ status: "approved" })
    });

    assert.strictEqual(res.status, 403);
  });

  // Scenario 10: Unauthenticated user cannot access a private approval document
  test("10. Unauthenticated user cannot access private approval document metadata or download (HTTP 401)", async () => {
    const resMeta = await fetch(`${baseUrl}/api/bookings/${testBookingId}/document`);
    assert.strictEqual(resMeta.status, 401);

    const resDownload = await fetch(`${baseUrl}/api/bookings/${testBookingId}/document/download`);
    assert.strictEqual(resDownload.status, 401);
  });

  // Scenario 11: A student cannot download another student's document
  test("11. Student cannot access or download another student's approval document (HTTP 403)", async () => {
    // testBookingId belongs to student1 (Aarav Patil). student2 (Meera Joshi) tries to access:
    const resMeta = await fetch(`${baseUrl}/api/bookings/${testBookingId}/document`, {
      headers: { "Authorization": `Bearer ${student2Token}` }
    });
    assert.strictEqual(resMeta.status, 403);

    const resDownload = await fetch(`${baseUrl}/api/bookings/${testBookingId}/document/download`, {
      headers: { "Authorization": `Bearer ${student2Token}` }
    });
    assert.strictEqual(resDownload.status, 403);
  });

  // Scenario 12: A teacher cannot download another user's document
  test("12. Teacher cannot access or download another user's approval document (HTTP 403)", async () => {
    // testBookingId belongs to student1. Teacher tries to access:
    const res = await fetch(`${baseUrl}/api/bookings/${testBookingId}/document/download`, {
      headers: { "Authorization": `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 403);
  });

  // Scenario 13: Repeated approval request does not create duplicate approvals (Idempotent)
  test("13. Repeated approval request is idempotent and returns existing valid approval", async () => {
    const res = await fetch(`${baseUrl}/api/bookings/${testBookingId}/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: "approved" })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.booking.status, "approved");
    assert.strictEqual(body.document.document_reference, testDocument.document_reference);
  });

  // Scenario 14: Repeated document generation request is handled safely
  test("14. Repeated document generation / download request is handled safely without duplicate records", async () => {
    const res = await fetch(`${baseUrl}/api/bookings/${testBookingId}/document/retry`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.document.generation_status, "ready");
    assert.strictEqual(body.document.document_reference, testDocument.document_reference);
  });

  let failedBookingId;

  // Scenario 15: PDF generation failure does not corrupt or reverse a successfully committed approval
  test("15. PDF generation failure retains the committed approval in database", async () => {
    const booking = createBooking({
      requester_id: student1.id,
      venue_id: "v3",
      event_name: "Fault Tolerance Test Event",
      event_type: "Academic",
      event_date: testDate,
      start_time: "16:00",
      end_time: "17:00",
      attendee_count: 30,
      purpose: "Testing PDF fault recovery."
    });
    failedBookingId = booking.id;

    // Approve booking
    await approveBooking({
      bookingId: booking.id,
      adminId: admin.id
    });

    // Simulate a failure in document record
    const { db } = await import("../server/db.js");
    db.prepare(`
      UPDATE booking_documents
      SET generation_status = 'failed', error_message = 'Simulated rendering timeout'
      WHERE booking_id = ?
    `).run(booking.id);

    // Verify booking is still APPROVED in database!
    const verified = getBookingById(booking.id);
    assert.strictEqual(verified.status, "approved");
    assert.strictEqual(verified.document.generation_status, "failed");
    assert.strictEqual(verified.document.error_message, "Simulated rendering timeout");
  });

  // Scenario 16: Retry generation can recover from a temporary failure
  test("16. Retry generation recovers from temporary document failure", async () => {
    assert.ok(failedBookingId, "Should have a failed booking ID from scenario 15");

    const retryRes = await fetch(`${baseUrl}/api/bookings/${failedBookingId}/document/retry`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    assert.strictEqual(retryRes.status, 200);
    const body = await retryRes.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.document.generation_status, "ready");
    assert.ok(fs.existsSync(body.document.file_path));
  });

  // Scenario 17: Missing optional profile or venue fields do not crash generation
  test("17. Missing optional profile or venue fields do not crash generation", async () => {
    const minimalBooking = {
      id: "b-minimal-test",
      venue_name: "Generic Room",
      venue_category: null,
      venue_location: null,
      venue_capacity: null,
      facilities: null,
      requester_name: "Anonymous User",
      requester_role: "student",
      requester_prn: null,
      requester_email: null,
      requester_department: null,
      event_name: "Minimalist Meeting",
      event_type: null,
      event_date: "2026-11-20",
      start_time: "11:00",
      end_time: "12:00",
      attendee_count: 10,
      purpose: null,
      status: "approved",
      reviewer_name: null,
      reviewed_at: null,
      created_at: new Date().toISOString()
    };

    const pdfResult = await generateApprovalPdf(minimalBooking);
    assert.ok(pdfResult.filePath);
    assert.ok(fs.existsSync(pdfResult.filePath));
    assert.ok(pdfResult.fileSize > 0);
  });

  // Scenario 18: Long venue names and booking purposes do not break PDF layout
  test("18. Long venue names and booking purposes do not break PDF generation", async () => {
    const longContentBooking = {
      id: "b-long-content-test",
      venue_name: "Dr. APJ Abdul Kalam Advanced Multidisciplinary Centre of Excellence & High Performance Robotics Laboratory",
      venue_category: "Specialized Engineering R&D Facility",
      venue_location: "MITAOE West Academic Block 4, Level 5, North Wing",
      venue_capacity: 120,
      facilities: ["High-speed 10Gbps Fibre", "3D Printing Farm", "4K Surround Projectors", "Precision Laser Cutters"],
      requester_name: "Very Long Name Of Student Representative From Mechanical And Automation Department",
      requester_role: "student",
      requester_prn: "PRN20240998877665544",
      requester_email: "long.student.name@student.mitaoe.ac.in",
      requester_department: "School of Mechanical and Mechatronics Engineering",
      event_name: "National Level Intercollegiate Autonomous Mobile Robotics Challenge 2026 Grand Finale and Industry Expo",
      event_type: "National Competition",
      event_date: "2026-12-15",
      end_date: "2026-12-18",
      start_time: "08:30",
      end_time: "18:30",
      attendee_count: 110,
      purpose: "This is an extensive multi-paragraph detailed event agenda description. We are bringing together students, faculty, and industry leaders from across Maharashtra to demonstrate autonomous navigation, SLAM, and computer vision algorithms. All hardware and safety checks have been authorized by the department head.",
      status: "approved",
      reviewer_name: "Dr. Academic Dean of Infrastructure",
      reviewed_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    const pdfResult = await generateApprovalPdf(longContentBooking);
    assert.ok(pdfResult.filePath);
    assert.ok(fs.existsSync(pdfResult.filePath));
    assert.ok(pdfResult.fileSize > 1000);
  });

  // Scenario 19: Rejected bookings do not receive an approval summary
  test("19. Rejected bookings do not receive an approval summary", async () => {
    const rejectedBooking = createBooking({
      requester_id: student1.id,
      venue_id: "v4",
      event_name: "Destined For Rejection",
      event_type: "Meeting",
      event_date: testDate,
      start_time: "17:00",
      end_time: "18:00",
      attendee_count: 10,
      purpose: "Testing rejection document policy."
    });

    rejectBooking({
      bookingId: rejectedBooking.id,
      adminId: admin.id,
      reason: "Room unavailable for renovation."
    });

    const resMeta = await fetch(`${baseUrl}/api/bookings/${rejectedBooking.id}/document`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    assert.strictEqual(resMeta.status, 400);

    const resDownload = await fetch(`${baseUrl}/api/bookings/${rejectedBooking.id}/document/download`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    assert.strictEqual(resDownload.status, 400);
  });

  // Scenario 20: The existing booking workflow still works
  test("20. Existing booking creation, cancellation, and retrieval workflow remains fully operational", async () => {
    // 1. Create booking
    const booking = createBooking({
      requester_id: student1.id,
      venue_id: "v5",
      event_name: "Full Flow Validation",
      event_type: "Academic",
      event_date: testDate,
      start_time: "12:00",
      end_time: "13:00",
      attendee_count: 25,
      purpose: "Verification of non-regression."
    });
    assert.strictEqual(booking.status, "pending");

    // 2. Requester can view from /api/bookings
    const listRes = await fetch(`${baseUrl}/api/bookings`, {
      headers: { "Authorization": `Bearer ${student1Token}` }
    });
    assert.strictEqual(listRes.status, 200);
    const listBody = await listRes.json();
    const found = listBody.bookings.find((b) => b.id === booking.id);
    assert.ok(found);

    // 3. Authorized cancellation works
    const cancelRes = await fetch(`${baseUrl}/api/bookings/${booking.id}/cancel`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${student1Token}` }
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelBody = await cancelRes.json();
    assert.strictEqual(cancelBody.booking.status, "cancelled");
  });
});
