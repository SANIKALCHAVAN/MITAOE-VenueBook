import * as XLSX from "xlsx";
import { STUDENTS_LIST, CLASS_COORDINATOR } from "./studentsData.js";

/**
 * Generate a complete, beautifully structured Excel workbook for MITAOE Venue Booking System
 * with official college headers, date-sorted requests, student roll-call summaries, and venue stats.
 */
export function generateVenueBookingExcel({ bookings = [], students = STUDENTS_LIST, venues = [], dateFrom = "", dateTo = "" }) {
  const wb = XLSX.utils.book_new();
  const generatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  // -------------------------------------------------------------
  // SHEET 1: ALL BOOKING REQUESTS (Date-Sorted)
  // -------------------------------------------------------------
  // Sort bookings strictly by event_date (or created_at) descending
  const sortedBookings = [...bookings].sort((a, b) => {
    const dateComp = (b.event_date || "").localeCompare(a.event_date || "");
    if (dateComp !== 0) return dateComp;
    return (b.start_time || "").localeCompare(a.start_time || "");
  });

  const sheet1Data = [
    ["MIT ACADEMY OF ENGINEERING, PUNE"],
    ["(An Autonomous Institute Affiliated to Savitribai Phule Pune University)"],
    ["CAMPUS ROOM BOOKING & FACILITY REQUEST REPORT"],
    [`Academic Year: ${CLASS_COORDINATOR.academic_year} | Term: ${CLASS_COORDINATOR.term} | Division: ${CLASS_COORDINATOR.division} | Class Coordinator: ${CLASS_COORDINATOR.name}`],
    [`Report Generated: ${generatedAt} | Filter: ${dateFrom ? `From ${dateFrom} ` : ""}${dateTo ? `To ${dateTo}` : "All Dates"}`],
    [], // Blank row
    [
      "Sr No",
      "Request Timestamp",
      "PRN No",
      "Student Full Name",
      "Mobile No",
      "Batch",
      "Room / Venue",
      "Event Date",
      "End Date",
      "Time Slot",
      "Event Name",
      "Attendees",
      "Purpose / Reason",
      "Status",
      "Admin Remark / Rejection Reason",
      "Reviewed By",
      "Review Timestamp"
    ]
  ];

  sortedBookings.forEach((b, index) => {
    const timeSlotDisplay = b.time_slot || `${b.start_time || ""} - ${b.end_time || ""}`;
    sheet1Data.push([
      index + 1,
      b.created_at ? new Date(b.created_at).toLocaleString("en-IN") : "—",
      b.requester_prn || "—",
      b.requester_name || "—",
      b.requester_mobile || "—",
      b.requester_batch || "—",
      b.venue_name || "—",
      b.event_date || "—",
      b.end_date || b.event_date || "—",
      timeSlotDisplay,
      b.event_name || "—",
      b.attendee_count || 1,
      b.purpose || "—",
      (b.status || "pending").toUpperCase(),
      b.rejection_reason || b.admin_remark || "—",
      b.reviewer_name || "—",
      b.reviewed_at ? new Date(b.reviewed_at).toLocaleString("en-IN") : "—"
    ]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);

  // Column widths for readability
  ws1["!cols"] = [
    { wch: 8 },  // Sr No
    { wch: 22 }, // Request Timestamp
    { wch: 16 }, // PRN
    { wch: 28 }, // Name
    { wch: 14 }, // Mobile
    { wch: 8 },  // Batch
    { wch: 24 }, // Room
    { wch: 13 }, // Event Date
    { wch: 13 }, // End Date
    { wch: 22 }, // Slot
    { wch: 28 }, // Event Name
    { wch: 10 }, // Attendees
    { wch: 35 }, // Purpose
    { wch: 12 }, // Status
    { wch: 30 }, // Admin Remark
    { wch: 20 }, // Reviewer
    { wch: 22 }  // Review Time
  ];

  XLSX.utils.book_append_sheet(wb, ws1, "All Booking Requests");

  // -------------------------------------------------------------
  // SHEET 2: APPROVED BOOKINGS ONLY
  // -------------------------------------------------------------
  const approvedBookings = sortedBookings.filter(b => b.status === "approved");
  const sheet2Data = [
    ["MIT ACADEMY OF ENGINEERING - CONFIRMED ROOM ALLOCATIONS"],
    [`Class Coordinator: ${CLASS_COORDINATOR.name} (${CLASS_COORDINATOR.division}) | Total Approved: ${approvedBookings.length}`],
    [],
    [
      "Sr No",
      "Approval Ref",
      "PRN No",
      "Student Name",
      "Mobile No",
      "Batch",
      "Allocated Venue",
      "Booking Date",
      "Time Window",
      "Event Title",
      "Expected Attendance",
      "Purpose",
      "Authorized By",
      "Approved Date"
    ]
  ];

  approvedBookings.forEach((b, index) => {
    sheet2Data.push([
      index + 1,
      b.document?.approval_reference || `APP-${b.id}`,
      b.requester_prn || "—",
      b.requester_name || "—",
      b.requester_mobile || "—",
      b.requester_batch || "—",
      b.venue_name || "—",
      b.event_date || "—",
      b.time_slot || `${b.start_time} - ${b.end_time}`,
      b.event_name || "—",
      b.attendee_count || 1,
      b.purpose || "—",
      b.reviewer_name || CLASS_COORDINATOR.name,
      b.reviewed_at ? new Date(b.reviewed_at).toLocaleDateString("en-IN") : "—"
    ]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  ws2["!cols"] = [
    { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 28 }, { wch: 14 },
    { wch: 8 }, { wch: 24 }, { wch: 14 }, { wch: 22 }, { wch: 28 },
    { wch: 12 }, { wch: 35 }, { wch: 20 }, { wch: 15 }
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Approved Bookings");

  // -------------------------------------------------------------
  // SHEET 3: FULL STUDENT ROLL CALL (74 Students) & BOOKING SUMMARY
  // -------------------------------------------------------------
  const sheet3Data = [
    ["MIT ACADEMY OF ENGINEERING - TY DIVISION A ROLL CALL & BOOKING SUMMARY"],
    [`Academic Year: ${CLASS_COORDINATOR.academic_year} ; ${CLASS_COORDINATOR.term} | Class Coordinator: ${CLASS_COORDINATOR.name}`],
    [],
    [
      "Roll No",
      "PRN No",
      "Student Full Name",
      "Mobile No",
      "College Email ID",
      "Batch",
      "Division",
      "Total Requests",
      "Approved",
      "Pending",
      "Rejected",
      "Active User Status"
    ]
  ];

  const studentBookingsMap = new Map();
  for (const b of bookings) {
    const prn = b.requester_prn;
    if (!prn) continue;
    if (!studentBookingsMap.has(prn)) {
      studentBookingsMap.set(prn, { total: 0, approved: 0, pending: 0, rejected: 0 });
    }
    const stat = studentBookingsMap.get(prn);
    stat.total++;
    if (b.status === "approved") stat.approved++;
    else if (b.status === "pending") stat.pending++;
    else if (b.status === "rejected") stat.rejected++;
  }

  students.forEach((s) => {
    const stat = studentBookingsMap.get(s.prn) || { total: 0, approved: 0, pending: 0, rejected: 0 };
    sheet3Data.push([
      s.sr_no,
      s.prn,
      s.full_name,
      s.mobile,
      s.email,
      s.batch,
      s.division || "Div-A",
      stat.total,
      stat.approved,
      stat.pending,
      stat.rejected,
      "Active / Pre-enrolled"
    ]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  ws3["!cols"] = [
    { wch: 8 },  // Roll No
    { wch: 16 }, // PRN No
    { wch: 30 }, // Full Name
    { wch: 14 }, // Mobile No
    { wch: 32 }, // College Mail
    { wch: 8 },  // Batch
    { wch: 10 }, // Div
    { wch: 14 }, // Total
    { wch: 12 }, // Approved
    { wch: 10 }, // Pending
    { wch: 10 }, // Rejected
    { wch: 20 }  // Status
  ];
  XLSX.utils.book_append_sheet(wb, ws3, "Student Roll Call List");

  // -------------------------------------------------------------
  // SHEET 4: ROOM INVENTORY & STATUS
  // -------------------------------------------------------------
  const sheet4Data = [
    ["MIT ACADEMY OF ENGINEERING - CAMPUS VENUE INVENTORY"],
    [`Generated: ${generatedAt}`],
    [],
    [
      "Venue ID",
      "Room / Facility Name",
      "Category",
      "Location",
      "Capacity",
      "Status",
      "Facilities & Equipment",
      "Total Bookings Received",
      "Approved Bookings"
    ]
  ];

  venues.forEach((v) => {
    const vBookings = bookings.filter(b => b.venue_id === v.id);
    const vApproved = vBookings.filter(b => b.status === "approved");
    const facilitiesStr = Array.isArray(v.facilities)
      ? v.facilities.join(", ")
      : (typeof v.facilities === "string" ? v.facilities : "");

    sheet4Data.push([
      v.id,
      v.name,
      v.category,
      v.location,
      v.capacity,
      v.is_active ? "Operational / Available" : "Under Maintenance",
      facilitiesStr,
      vBookings.length,
      vApproved.length
    ]);
  });

  const ws4 = XLSX.utils.aoa_to_sheet(sheet4Data);
  ws4["!cols"] = [
    { wch: 10 }, { wch: 30 }, { wch: 18 }, { wch: 30 },
    { wch: 10 }, { wch: 22 }, { wch: 45 }, { wch: 22 }, { wch: 18 }
  ];
  XLSX.utils.book_append_sheet(wb, ws4, "Rooms & Facilities");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
