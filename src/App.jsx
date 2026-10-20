import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownUp, ArrowRight, CalendarDays, Check, ChevronDown, ChevronUp,
  Clock3, DoorOpen, Filter, LayoutDashboard, LogIn, LogOut, Menu,
  Plus, Search, ShieldCheck, Users, X, Building2, MapPin, Wifi, Monitor,
  Coffee, CheckCircle2, CircleAlert, LoaderCircle, Bell, User,
  FileText, ShieldAlert, KeyRound, UserCheck, UserPlus, RefreshCw, AlertTriangle,
  Eye, EyeOff, HelpCircle, Info, Sparkles, GraduationCap, School, Lock, ExternalLink
} from "lucide-react";
import { api, getStoredToken } from "./api.js";
import { getVenueImage } from "./venueImages.js";

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fmtDate = (value) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDateRange = (startDate, endDate) => {
  if (!startDate) return "—";
  if (!endDate || endDate === startDate) return fmtDate(startDate);
  return `${fmtDate(startDate)} → ${fmtDate(endDate)}`;
};
const fmtTime = (value) =>
  value ? new Date(`2000-01-01T${value}`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—";
const statusClass = (s) => `status status-${s || "pending"}`;

export default function App() {
  const [page, setPage] = useState("Home"); // Home | Overview | Explore venues | My bookings | Admin Approvals | Profile
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authRole, setAuthRole] = useState("student"); // student | teacher | admin
  const [formOpen, setFormOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [selectedDetailVenue, setSelectedDetailVenue] = useState(null);
  const [approvalReviewBooking, setApprovalReviewBooking] = useState(null);
  const [faqOpenIndex, setFaqOpenIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All venues");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // Modals & Panels
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTargetBooking, setRejectTargetBooking] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [venueModalOpen, setVenueModalOpen] = useState(false);
  const [venueForm, setVenueForm] = useState({
    id: "", name: "", category: "Seminar Hall", location: "Academic Block",
    capacity: 60, facilities: "Projector, Wi-Fi", description: "", color: "lavender", is_active: true
  });
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userForm, setUserForm] = useState({
    full_name: "", role: "student", prn: "", email: "", department: "Computer Engineering", password: ""
  });
  const [adminUsers, setAdminUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [adminTab, setAdminTab] = useState("approvals"); // approvals | venues | users | logs
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [recoverModalOpen, setRecoverModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  // Booking Form State
  const [form, setForm] = useState({
    venue_id: "", event_name: "", event_type: "Academic",
    start_date: futureDate(1), end_date: futureDate(1), event_date: futureDate(1),
    start_time: "10:00", end_time: "11:00", attendee_count: "25", purpose: ""
  });

  const isAdmin = user?.role === "admin";
  const isTeacher = user?.role === "teacher";
  const isStudent = user?.role === "student";

  const [systemStatus, setSystemStatus] = useState(null);

  // Check existing session on load
  useEffect(() => {
    api.getSystemStatus().then(setSystemStatus).catch(() => {});
    if (getStoredToken()) {
      api.getMe()
        .then((res) => {
          if (res.user) {
            setUser(res.user);
            setPage("Overview");
          }
        })
        .catch(() => {
          api.logout();
          setUser(null);
          setPage("Home");
        });
    }
    loadData();
  }, []);

  // Reload data when user changes
  useEffect(() => {
    loadData();
    if (user) {
      loadNotifications();
    }
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const [vRes, bRes] = await Promise.all([
        api.getVenues(true).catch(() => ({ venues: [] })),
        user ? api.getBookings().catch(() => ({ bookings: [] })) : Promise.resolve({ bookings: [] })
      ]);
      setVenues(vRes.venues || []);
      setBookings(bRes.bookings || []);

      if (user?.role === "admin") {
        const statsRes = await api.getAdminStats().catch(() => null);
        if (statsRes) setStats(statsRes.stats);
      }
    } catch (err) {
      setNotice(`Data load error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    if (!user) return;
    try {
      const res = await api.getNotifications();
      setNotifications(res.notifications || []);
    } catch {}
  }

  async function loadAdminExtras(tab) {
    if (!isAdmin) return;
    try {
      if (tab === "users") {
        const uRes = await api.getUsers();
        setAdminUsers(uRes.users || []);
      } else if (tab === "logs") {
        const lRes = await api.getAuditLogs(50);
        setAuditLogs(lRes.logs || []);
      }
    } catch (err) {
      setNotice(`Failed to load ${tab}: ${err.message}`);
    }
  }

  // Filtered venues for explore page & preview
  const filteredVenues = useMemo(() => {
    return venues.filter((v) => {
      if (!isAdmin && !v.is_active) return false;
      const matchSearch = `${v.name} ${v.category} ${v.location}`.toLowerCase().includes(search.toLowerCase());
      return matchSearch && (filterType === "All venues" || v.category === filterType);
    });
  }, [venues, search, filterType, isAdmin]);

  // Filtered bookings
  const pending = useMemo(() => bookings.filter((b) => b.status === "pending"), [bookings]);
  const approved = useMemo(() => bookings.filter((b) => b.status === "approved"), [bookings]);
  const rejected = useMemo(() => bookings.filter((b) => b.status === "rejected"), [bookings]);

  // Auth Operations
  async function handleStudentLogin(prn, password) {
    setAuthLoading(true);
    try {
      const res = await api.loginStudent(prn, password);
      setUser(res.user);
      setAuthOpen(false);
      setNotice(`Welcome, ${res.user.full_name}! Signed in as Student.`);
      setPage("Overview");
    } catch (err) {
      setNotice(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleTeacherLogin(email, password) {
    setAuthLoading(true);
    try {
      const res = await api.loginTeacher(email, password);
      setUser(res.user);
      setAuthOpen(false);
      setNotice(`Welcome, ${res.user.full_name}! Signed in as Teacher.`);
      setPage("Overview");
    } catch (err) {
      setNotice(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleAdminLogin(email, password) {
    setAuthLoading(true);
    try {
      const res = await api.loginAdmin(email, password);
      setUser(res.user);
      setAuthOpen(false);
      setNotice(`Administrator privileges granted. Welcome, ${res.user.full_name}.`);
      setPage("Admin Approvals");
    } catch (err) {
      setNotice(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSignOut() {
    api.logout();
    setUser(null);
    setBookings([]);
    setPage("Home");
    setNotice("Signed out safely.");
  }

  function openRoleSignIn(role) {
    setAuthRole(role);
    setAuthOpen(true);
  }

  // Booking Submission
  async function submitBooking(e) {
    e.preventDefault();
    if (!user) {
      setNotice("Authentication required: Please sign in to submit a venue request.");
      setAuthOpen(true);
      return;
    }

    if (!form.venue_id) { setNotice("Choose a venue before submitting."); return; }
    const startDate = form.start_date || form.event_date;
    const endDate = form.end_date || startDate;

    if (endDate < startDate) {
      setNotice("Ending date cannot be earlier than starting date.");
      return;
    }
    if (startDate === endDate && form.start_time >= form.end_time) {
      setNotice("End time must be strictly later than start time for single-day events.");
      return;
    }
    if (new Date(`${startDate}T${form.start_time}`) <= new Date()) {
      setNotice("Event start date and time must be in the future.");
      return;
    }

    const targetVenue = venues.find((v) => v.id === form.venue_id);
    if (!targetVenue) { setNotice("Selected venue could not be found."); return; }
    if (!targetVenue.is_active) { setNotice("This venue is inactive and cannot accept booking requests."); return; }

    const attendees = Number(form.attendee_count);
    if (attendees < 1 || attendees > Number(targetVenue.capacity)) {
      setNotice(`Expected attendee count must be between 1 and ${targetVenue.capacity} for this venue.`);
      return;
    }

    setLoading(true);
    try {
      await api.createBooking({
        venue_id: form.venue_id,
        event_name: form.event_name.trim(),
        event_type: form.event_type,
        start_date: startDate,
        end_date: endDate,
        event_date: startDate,
        start_time: form.start_time,
        end_time: form.end_time,
        attendee_count: attendees,
        purpose: form.purpose.trim()
      });

      setFormOpen(false);
      setForm({
        venue_id: "", event_name: "", event_type: "Academic",
        start_date: futureDate(1), end_date: futureDate(1), event_date: futureDate(1),
        start_time: "10:00", end_time: "11:00",
        attendee_count: "25", purpose: ""
      });
      setNotice("Booking request submitted successfully! It is now pending administrator approval.");
      await loadData();
      setPage("My bookings");
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Admin Deliberate Approval
  function promptApprove(booking) {
    setApprovalReviewBooking(booking);
  }

  async function confirmApproval() {
    if (!isAdmin || !approvalReviewBooking) return;
    try {
      await api.updateBookingStatus(approvalReviewBooking.id, "approved");
      setNotice(`Booking "${approvalReviewBooking.event_name}" approved successfully.`);
      setApprovalReviewBooking(null);
      await loadData();
    } catch (err) {
      setNotice(`Approval error: ${err.message}`);
    }
  }

  // Admin Rejection
  function promptReject(booking) {
    setRejectTargetBooking(booking);
    setRejectReason("");
    setRejectModalOpen(true);
  }

  async function confirmReject() {
    if (!rejectTargetBooking || !rejectReason.trim()) {
      setNotice("A reason is mandatory when declining a booking request.");
      return;
    }
    try {
      await api.updateBookingStatus(rejectTargetBooking.id, "rejected", rejectReason.trim());
      setRejectModalOpen(false);
      setRejectTargetBooking(null);
      setNotice(`Booking "${rejectTargetBooking.event_name}" was rejected.`);
      await loadData();
    } catch (err) {
      setNotice(`Rejection failed: ${err.message}`);
    }
  }

  async function cancelOwnBooking(booking) {
    if (!confirm(`Are you sure you want to cancel your request for "${booking.event_name}"?`)) return;
    try {
      await api.cancelBooking(booking.id);
      setNotice("Your booking request has been cancelled.");
      await loadData();
    } catch (err) {
      setNotice(`Cancellation error: ${err.message}`);
    }
  }

  // Venue Management
  function openAddVenue() {
    setVenueForm({
      id: "", name: "", category: "Seminar Hall", location: "Academic Block",
      capacity: 60, facilities: "Projector, Wi-Fi", description: "", color: "lavender", is_active: true
    });
    setVenueModalOpen(true);
  }

  function openEditVenue(venue) {
    setVenueForm({
      id: venue.id,
      name: venue.name,
      category: venue.category,
      location: venue.location,
      capacity: venue.capacity,
      facilities: (venue.facilities || []).join(", "),
      description: venue.description || "",
      color: venue.color || "lavender",
      is_active: venue.is_active
    });
    setVenueModalOpen(true);
  }

  async function saveVenue(e) {
    e.preventDefault();
    try {
      const payload = {
        name: venueForm.name.trim(),
        category: venueForm.category,
        location: venueForm.location.trim(),
        capacity: Number(venueForm.capacity),
        facilities: venueForm.facilities.split(",").map((s) => s.trim()).filter(Boolean),
        description: venueForm.description.trim(),
        color: venueForm.color,
        is_active: venueForm.is_active
      };

      if (venueForm.id) {
        await api.updateVenue(venueForm.id, payload);
        setNotice(`Venue "${venueForm.name}" updated successfully.`);
      } else {
        await api.createVenue(payload);
        setNotice(`Venue "${venueForm.name}" added to campus roster.`);
      }

      setVenueModalOpen(false);
      await loadData();
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function toggleVenueActive(venue) {
    try {
      await api.updateVenue(venue.id, { is_active: !venue.is_active });
      setNotice(`Venue "${venue.name}" is now ${!venue.is_active ? "active" : "inactive"}.`);
      await loadData();
    } catch (err) {
      setNotice(err.message);
    }
  }

  // User Provisioning by Admin
  async function saveProvisionedUser(e) {
    e.preventDefault();
    try {
      await api.provisionUser({
        full_name: userForm.full_name.trim(),
        role: userForm.role,
        prn: userForm.role === "student" ? userForm.prn.trim().toUpperCase() : null,
        email: userForm.role !== "student" ? userForm.email.trim().toLowerCase() : (userForm.email ? userForm.email.trim().toLowerCase() : null),
        department: userForm.department,
        password: userForm.password
      });
      setUserModalOpen(false);
      setUserForm({ full_name: "", role: "student", prn: "", email: "", department: "Computer Engineering", password: "" });
      setNotice(`Account provisioned successfully for ${userForm.full_name}.`);
      loadAdminExtras("users");
    } catch (err) {
      setNotice(`Account provisioning error: ${err.message}`);
    }
  }

  function handleStartBookingForVenue(venue) {
    if (!user) {
      setNotice(`Please sign in as a student or teacher to request ${venue.name}.`);
      setSelectedDetailVenue(null);
      setAuthOpen(true);
      return;
    }
    setSelectedDetailVenue(null);
    setSelectedVenue(venue);
    setForm((f) => ({ ...f, venue_id: venue.id }));
    setFormOpen(true);
  }

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  // Navigation Items for Authenticated Users
  const navItems = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "Explore venues", icon: Building2 },
    ...(user ? [{ name: "New booking", icon: Plus, action: () => { setSelectedVenue(null); setFormOpen(true); } }] : []),
    ...(user ? [{ name: "My bookings", icon: CalendarDays }] : []),
    ...(isAdmin ? [{ name: "Admin Approvals", icon: ShieldCheck, count: pending.length }] : []),
    ...(user ? [{ name: "Profile", icon: User }] : [])
  ];

  // -------------------------------------------------------------
  // RENDER: SIGNED-OUT VISITOR EXPERIENCE (Public Landing Page)
  // -------------------------------------------------------------
  if (!user && page !== "Explore venues") {
    return (
      <div className="visitor-shell">
        {/* Navigation Bar */}
        <header className="public-navbar">
          <div className="public-nav-container">
            <div className="public-nav-brand" onClick={() => setPage("Home")}>
              <div className="brand-mark"><DoorOpen size={20} /></div>
              <div>
                <strong>VenueBook</strong>
                <span>MITAOE CAMPUS</span>
              </div>
            </div>

            <nav className="public-nav-links">
              <button
                className={`public-nav-link ${page === "Home" ? "active" : ""}`}
                onClick={() => setPage("Home")}
              >
                Home
              </button>
              <button
                className="public-nav-link"
                onClick={() => setPage("Explore venues")}
              >
                Explore Venues
              </button>
              <button
                className="public-nav-link"
                onClick={() => {
                  const el = document.getElementById("how-it-works");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
              >
                How It Works
              </button>
              <button
                className="public-nav-link"
                onClick={() => {
                  const el = document.getElementById("about-section");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
              >
                About
              </button>
              <button
                className="public-nav-link"
                onClick={() => {
                  const el = document.getElementById("faq-section");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
              >
                FAQ
              </button>
            </nav>

            <div className="public-nav-actions">
              <div
                className={`connection-pill ${systemStatus?.status === "action_required" ? "warning" : "connected"}`}
                title="Authoritative Supabase PostgreSQL Database Connection"
              >
                <span />
                {systemStatus?.database || "Supabase PostgreSQL"} Active
              </div>
              <button className="button button-secondary" onClick={() => setAuthOpen(true)}>
                <LogIn size={15} /> Sign In
              </button>
              <button className="button button-primary" onClick={() => openRoleSignIn("student")}>
                Get Started
              </button>
            </div>
          </div>
        </header>

        {notice && (
          <div className="notice" style={{ maxWidth: "1240px", margin: "16px auto 0", width: "calc(100% - 48px)" }}>
            <CircleAlert size={17} />
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16} /></button>
          </div>
        )}

        <main>
          {/* Hero Section */}
          <section className="landing-hero">
            <div className="hero-box">
              <div className="hero-content">
                <div className="hero-badge">
                  <ShieldCheck size={14} /> MITAOE CAMPUS VENUEBOOK
                </div>
                <h1 className="hero-title">
                  Find the right campus space. <br />
                  <span>Book it with confidence.</span>
                </h1>
                <p className="hero-subtitle">
                  Explore campus venues, submit booking requests, and follow approval updates through one centralized platform for the MITAOE community.
                </p>
                <div className="hero-cta-group">
                  <button className="button button-primary" onClick={() => setPage("Explore venues")}>
                    <Building2 size={16} /> Explore Venues
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      const el = document.getElementById("how-it-works");
                      if (el) el.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    How It Works <ArrowRight size={15} />
                  </button>
                </div>
              </div>

              {/* Genuine Architectural Visual Card */}
              <div className="hero-visual-card">
                <div className="visual-header">
                  <div className="visual-badge">
                    <Building2 size={16} color="var(--purple)" />
                    <span>MITAOE Institutional Facility Directory</span>
                  </div>
                  <div className="visual-live-indicator">
                    <span />
                    Live System
                  </div>
                </div>

                <div className="visual-building-preview">
                  <div className="building-row">
                    <span>Campus Spaces Available:</span>
                    <strong>{venues.filter((v) => v.is_active).length} Bookable Halls</strong>
                  </div>
                  <div className="building-row">
                    <span>Institutional Coverage:</span>
                    <strong>Academic & Central Blocks</strong>
                  </div>
                  <div className="building-row">
                    <span>Approval Governance:</span>
                    <strong>Administrative Oversight</strong>
                  </div>
                  <div className="visual-tag-list">
                    <span className="visual-tag">Conflict Prevention Active</span>
                    <span className="visual-tag">Audit Trail Enabled</span>
                    <span className="visual-tag">Role Separation</span>
                  </div>
                </div>

                <div className="visual-note">
                  <Info size={16} color="#6558e8" />
                  <span>
                    Designed for Pune District, Alandi Campus students, educators, and event organizers.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Explain What VenueBook Is Section */}
          <section className="landing-section" id="about-section">
            <div className="section-intro">
              <div className="eyebrow"><span className="eyebrow-dot" /> PURPOSE & CAPABILITIES</div>
              <h2>Campus space booking, made clear.</h2>
              <p>
                VenueBook helps eligible students and teachers discover campus spaces and request bookings, with an administrator responsible for reviewing requests.
              </p>
            </div>

            <div className="feature-cards-grid">
              <div className="feature-card">
                <div className="feature-card-icon"><Building2 size={24} /></div>
                <h3>Discover Spaces</h3>
                <p>Browse venue information, facilities, capacity, photographs, and location when available.</p>
              </div>

              <div className="feature-card">
                <div className="feature-card-icon"><CalendarDays size={24} /></div>
                <h3>Request a Booking</h3>
                <p>Select a venue and complete the booking form with the information requested by the system.</p>
              </div>

              <div className="feature-card">
                <div className="feature-card-icon"><ShieldCheck size={24} /></div>
                <h3>Track Approval</h3>
                <p>Follow the request status and read any available administrator feedback.</p>
              </div>
            </div>
          </section>

          {/* How It Works Section */}
          <section className="landing-section" id="how-it-works">
            <div className="section-intro">
              <div className="eyebrow"><span className="eyebrow-dot" /> STEP-BY-STEP PROCESS</div>
              <h2>How VenueBook Works</h2>
              <p>A transparent booking and review procedure designed for college community spaces.</p>
            </div>

            <div className="workflow-steps-grid">
              <div className="workflow-step-card">
                <span className="workflow-step-number">01</span>
                <strong>Sign In</strong>
                <p>Sign in using your authorized account (registered student PRN or college faculty email).</p>
              </div>

              <div className="workflow-step-card">
                <span className="workflow-step-number">02</span>
                <strong>Explore Venues</strong>
                <p>Explore available venue information, seating limits, and audiovisual infrastructure.</p>
              </div>

              <div className="workflow-step-card">
                <span className="workflow-step-number">03</span>
                <strong>Submit Request</strong>
                <p>Submit your booking request with your event date, timeslot, and event purpose.</p>
              </div>

              <div className="workflow-step-card">
                <span className="workflow-step-number">04</span>
                <strong>Track Status</strong>
                <p>Track the request in My Bookings as it progresses through the verification queue.</p>
              </div>

              <div className="workflow-step-card">
                <span className="workflow-step-number">05</span>
                <strong>Receive Decision</strong>
                <p>Receive the administrator's decision through the application's available status updates.</p>
              </div>
            </div>

            <div className="workflow-callout-box">
              <Info size={20} />
              <div>
                <strong>Important Note:</strong> Submitting a request does not automatically confirm a reservation. All bookings require administrator verification to ensure zero scheduling conflicts and facility safety.
              </div>
            </div>
          </section>

          {/* Who Can Use VenueBook? Section */}
          <section className="landing-section">
            <div className="section-intro">
              <div className="eyebrow"><span className="eyebrow-dot" /> CAMPUS AUDIENCE</div>
              <h2>Who Can Use VenueBook?</h2>
              <p>Tailored access and workflows for each role across the MITAOE community.</p>
            </div>

            <div className="role-cards-grid">
              {/* Student Role */}
              <div className="role-entry-card">
                <div className="role-card-top">
                  <div className="role-avatar-icon student"><GraduationCap size={22} /></div>
                  <span className="role-badge role-student">Student</span>
                </div>
                <h3>Students</h3>
                <p className="role-desc">For student associations, clubs, symposiums, and project presentations.</p>
                <ul className="role-checklist">
                  <li><Check size={15} /> Sign in using registered PRN and configured credentials.</li>
                  <li><Check size={15} /> Explore campus venues and seating capacities.</li>
                  <li><Check size={15} /> Submit booking requests for verified college events.</li>
                  <li><Check size={15} /> Track personal booking status and admin remarks.</li>
                </ul>
                <button className="button button-primary" onClick={() => openRoleSignIn("student")}>
                  Student Sign In <ArrowRight size={14} />
                </button>
              </div>

              {/* Teacher Role */}
              <div className="role-entry-card">
                <div className="role-card-top">
                  <div className="role-avatar-icon teacher"><School size={22} /></div>
                  <span className="role-badge role-teacher">Teacher</span>
                </div>
                <h3>Teachers</h3>
                <p className="role-desc">For faculty lectures, departmental workshops, and conference sessions.</p>
                <ul className="role-checklist">
                  <li><Check size={15} /> Sign in using assigned college email and configured authentication.</li>
                  <li><Check size={15} /> Explore venues and submit permitted academic requests.</li>
                  <li><Check size={15} /> Track personal booking status with priority review.</li>
                  <li><Check size={15} /> Organize departmental guest lectures and meetings.</li>
                </ul>
                <button className="button button-primary" onClick={() => openRoleSignIn("teacher")}>
                  Teacher Sign In <ArrowRight size={14} />
                </button>
              </div>

              {/* Administrator Role */}
              <div className="role-entry-card">
                <div className="role-card-top">
                  <div className="role-avatar-icon admin"><ShieldCheck size={22} /></div>
                  <span className="role-badge role-admin">Administrator</span>
                </div>
                <h3>Administrators</h3>
                <p className="role-desc">For campus estate officers and coordinators managing venue schedules.</p>
                <ul className="role-checklist">
                  <li><Check size={15} /> Access authorized administrative features securely.</li>
                  <li><Check size={15} /> Review pending requests with automated conflict checks.</li>
                  <li><Check size={15} /> Approve or reject requests with mandatory feedback.</li>
                  <li><Check size={15} /> Manage venue information and inspect audit records.</li>
                </ul>
                <button className="button button-primary" onClick={() => openRoleSignIn("admin")}>
                  Admin Sign In <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </section>

          {/* Explore Venues Curated Preview */}
          <section className="landing-section">
            <div className="section-heading">
              <div>
                <h2>Explore Campus Venues</h2>
                <p>Authentic records retrieved from the active Supabase PostgreSQL database.</p>
              </div>
              <button className="text-button" onClick={() => setPage("Explore venues")}>
                View all spaces <ArrowRight size={15} />
              </button>
            </div>

            <VenueGrid
              venues={venues.filter((v) => v.is_active).slice(0, 3)}
              onViewDetails={(v) => setSelectedDetailVenue(v)}
              onBook={(v) => handleStartBookingForVenue(v)}
            />
          </section>

          {/* Practical FAQ Section */}
          <section className="landing-section" id="faq-section">
            <div className="section-intro">
              <div className="eyebrow"><span className="eyebrow-dot" /> HELP & GUIDANCE</div>
              <h2>Frequently Asked Questions</h2>
              <p>Practical answers regarding account access, reservation protocols, and approval workflows.</p>
            </div>

            <div className="faq-accordion">
              {[
                {
                  q: "What is VenueBook?",
                  a: "VenueBook is MIT Academy of Engineering's dedicated platform for discovering campus facilities, submitting reservation requests, and tracking administrator approvals in real time."
                },
                {
                  q: "Who can use the platform?",
                  a: "Registered MITAOE students, faculty members, and authorized campus administrators whose accounts are configured in the institutional roster."
                },
                {
                  q: "How do I sign in as a student?",
                  a: "Students sign in using their official PRN (Permanent Registration Number) and their configured password. In testing mode, pre-registered test PRNs are available on the sign-in modal."
                },
                {
                  q: "How does a teacher sign in?",
                  a: "Faculty members sign in using their official @mitaoe.ac.in email address and account password."
                },
                {
                  q: "How do I submit a booking request?",
                  a: "After signing in, select 'Explore venues' or click 'New booking'. Choose the space, date, start and end times, attendee count, and event purpose, then submit."
                },
                {
                  q: "What does 'Pending' mean?",
                  a: "Pending indicates your booking request has been successfully saved in Supabase and is awaiting administrator verification. The space is not reserved until marked as Approved."
                },
                {
                  q: "Who approves booking requests?",
                  a: "Authorized MITAOE campus administrators evaluate each submission against university schedules, conflict constraints, and facility capacity before granting formal approval."
                },
                {
                  q: "How can I check my booking status?",
                  a: "Once signed in, visit 'My bookings' to view your complete submission history, status badges, and any rejection or approval remarks."
                },
                {
                  q: "What should I do if I cannot sign in?",
                  a: "Use the 'Forgot password?' recovery option in the sign-in modal or consult the campus administrator to ensure your PRN or email is provisioned in the roster."
                }
              ].map((item, idx) => (
                <div key={idx} className={`faq-item ${faqOpenIndex === idx ? "open" : ""}`}>
                  <button
                    className="faq-question"
                    onClick={() => setFaqOpenIndex(faqOpenIndex === idx ? null : idx)}
                  >
                    <span>{item.q}</span>
                    {faqOpenIndex === idx ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {faqOpenIndex === idx && (
                    <div className="faq-answer">
                      {item.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* Public Footer */}
        <footer className="public-footer">
          <div className="public-footer-inner">
            <div className="public-footer-brand">
              <div className="public-nav-brand">
                <div className="brand-mark"><DoorOpen size={20} /></div>
                <div>
                  <strong>VenueBook</strong>
                  <span>MITAOE CAMPUS</span>
                </div>
              </div>
              <p>
                MIT Academy of Engineering, Alandi (D), Pune - 412105. Centralized campus facility discovery and scheduling governance.
              </p>
            </div>

            <div className="footer-nav-col">
              <strong>PLATFORM NAVIGATION</strong>
              <ul>
                <li><button onClick={() => setPage("Home")}>Home Overview</button></li>
                <li><button onClick={() => setPage("Explore venues")}>Explore Campus Venues</button></li>
                <li><button onClick={() => { const el = document.getElementById("how-it-works"); if (el) el.scrollIntoView({ behavior: "smooth" }); }}>How It Works</button></li>
                <li><button onClick={() => { const el = document.getElementById("faq-section"); if (el) el.scrollIntoView({ behavior: "smooth" }); }}>Help & FAQ</button></li>
              </ul>
            </div>

            <div className="footer-nav-col">
              <strong>ROLE ACCESS</strong>
              <ul>
                <li><button onClick={() => openRoleSignIn("student")}>Student Access (PRN)</button></li>
                <li><button onClick={() => openRoleSignIn("teacher")}>Faculty Access (Email)</button></li>
                <li><button onClick={() => openRoleSignIn("admin")}>Administrator Portal</button></li>
                <li><button onClick={() => { setRecoverModalOpen(true); }}>Password Assistance</button></li>
              </ul>
            </div>
          </div>

          <div className="public-footer-bottom">
            <span>© {new Date().getFullYear()} MIT Academy of Engineering (MITAOE). All rights reserved.</span>
            <div className="connection-pill connected">
              <span />
              <span>PostgreSQL Active</span>
            </div>
          </div>
        </footer>

        {/* Global Modals for Guests */}
        {renderModals()}
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: AUTHENTICATED EXPERIENCE (Role-Specific Dashboards)
  // -------------------------------------------------------------
  return (
    <div className="app-shell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand" onClick={() => setPage("Overview")} style={{ cursor: "pointer" }}>
          <div className="brand-mark"><DoorOpen size={22} /></div>
          <div><strong>VenueBook</strong><span>MITAOE CAMPUS</span></div>
        </div>
        <div className="workspace-label">
          {user ? `${user.role.toUpperCase()} WORKSPACE` : "GUEST PORTAL"}
        </div>
        <nav>
          {navItems.map(({ name, icon: Icon, count, action }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? "active" : ""}`}
              onClick={() => {
                if (action) action();
                else setPage(name);
              }}
            >
              <Icon size={18} /><span>{name}</span>
              {Boolean(count) && count > 0 && <em className="nav-count">{count}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><ShieldCheck size={18} /></div>
            <strong>Verified Campus Portal</strong>
            <p>Admin authorization enforced for all room requests.</p>
          </div>
          <div className="profile-row">
            <div className="avatar">
              {(user?.full_name || "G").slice(0, 2).toUpperCase()}
            </div>
            <div className="profile-copy">
              <strong>{user ? user.full_name : "Visitor"}</strong>
              <span>
                {user ? (
                  <span className={`role-badge role-${user.role}`}>
                    {user.role} {user.prn ? `· ${user.prn}` : ""}
                  </span>
                ) : (
                  "Not signed in"
                )}
              </span>
            </div>
            {user ? (
              <button className="icon-button" title="Sign out" onClick={handleSignOut}><LogOut size={17} /></button>
            ) : (
              <button className="icon-button" title="Sign in" onClick={() => { setAuthOpen(true); }}><LogIn size={17} /></button>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>MITAOE</span><span className="crumb-slash">/</span>
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <div
              className={`connection-pill ${systemStatus?.status === "action_required" ? "warning" : "connected"}`}
              title={systemStatus?.schemaDetails || "Supabase PostgreSQL Database"}
            >
              <span />
              {systemStatus?.database || "Supabase PostgreSQL"} Active
            </div>

            {user && (
              <button className="icon-button notification-bell" title="Notifications" onClick={() => setNotifOpen(true)}>
                <Bell size={18} />
                {unreadNotifCount > 0 && <span className="notif-badge" />}
              </button>
            )}

            {user ? (
              <button className="button button-secondary" onClick={handleSignOut}>
                <LogOut size={16} /> Sign out
              </button>
            ) : (
              <button className="button button-primary" onClick={() => setAuthOpen(true)}>
                <LogIn size={16} /> Campus Sign In
              </button>
            )}

            <button
              className="button button-primary"
              onClick={() => {
                if (!user) {
                  setNotice("Please sign in before requesting a campus venue.");
                  setAuthOpen(true);
                  return;
                }
                setSelectedVenue(null);
                setFormOpen(true);
              }}
            >
              <Plus size={17} /> New booking
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice">
            <CircleAlert size={17} />
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16} /></button>
          </div>
        )}

        <div className="page-wrap">
          {/* ========================================================== */}
          {/* PAGE: OVERVIEW (STUDENT / TEACHER / GUEST VIEW) */}
          {/* ========================================================== */}
          {page === "Overview" && (
            <>
              {/* STUDENT DASHBOARD */}
              {isStudent && (
                <>
                  <div className="user-identity-banner">
                    <div className="identity-info">
                      <div className="identity-avatar">
                        {(user.full_name || "S").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="identity-copy">
                        <h2>Welcome, {user.full_name}</h2>
                        <div className="identity-chips">
                          <span className="role-badge role-student">Student</span>
                          <span className="identity-chip">PRN: {user.prn}</span>
                          <span className="identity-chip">Dept: {user.department || "Engineering"}</span>
                          {user.email && <span className="identity-chip">{user.email}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="identity-actions">
                      <button className="button button-secondary" onClick={() => setPage("Explore venues")}>
                        <Building2 size={16} /> Explore Venues
                      </button>
                      <button
                        className="button button-primary"
                        onClick={() => { setSelectedVenue(null); setFormOpen(true); }}
                      >
                        <Plus size={16} /> Request Space
                      </button>
                    </div>
                  </div>

                  <section className="stats-grid">
                    <Stat icon={Building2} label="Available venues" value={venues.filter((v) => v.is_active).length} sub="Active campus facilities" tint="violet" />
                    <Stat icon={CalendarDays} label="My requests" value={bookings.length} sub="Total personal submissions" tint="blue" />
                    <Stat icon={Clock3} label="Under review" value={pending.length} sub="Awaiting admin decision" tint="orange" />
                    <Stat icon={CheckCircle2} label="Approved slots" value={approved.length} sub="Confirmed reservation slots" tint="green" />
                  </section>

                  <section className="section-block">
                    <div className="section-heading">
                      <div>
                        <h2>Bookable Campus Venues</h2>
                        <p>Verified venues ready for student academic activities and events.</p>
                      </div>
                      <button className="text-button" onClick={() => setPage("Explore venues")}>
                        View all <ArrowRight size={15} />
                      </button>
                    </div>
                    <VenueGrid
                      venues={venues.filter((v) => v.is_active).slice(0, 3)}
                      onViewDetails={(v) => setSelectedDetailVenue(v)}
                      onBook={(v) => handleStartBookingForVenue(v)}
                    />
                  </section>

                  <section className="section-block recent-section">
                    <div className="section-heading">
                      <div>
                        <h2>My Recent Booking Requests</h2>
                        <p>Real-time status of your personal venue submissions.</p>
                      </div>
                      <button className="text-button" onClick={() => setPage("My bookings")}>
                        All my bookings <ArrowRight size={15} />
                      </button>
                    </div>
                    <BookingTable
                      bookings={bookings.slice(0, 5)}
                      onCancel={cancelOwnBooking}
                      currentUserId={user?.id}
                      isAdmin={false}
                      compact
                    />
                  </section>
                </>
              )}

              {/* TEACHER DASHBOARD */}
              {isTeacher && (
                <>
                  <div className="user-identity-banner">
                    <div className="identity-info">
                      <div className="identity-avatar" style={{ background: "#e6f8f0", color: "#047857" }}>
                        {(user.full_name || "T").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="identity-copy">
                        <h2>Welcome, Prof. {user.full_name}</h2>
                        <div className="identity-chips">
                          <span className="role-badge role-teacher">Faculty</span>
                          <span className="identity-chip">{user.email}</span>
                          <span className="identity-chip">Dept: {user.department || "Academic"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="identity-actions">
                      <button className="button button-secondary" onClick={() => setPage("Explore venues")}>
                        <Building2 size={16} /> Explore Venues
                      </button>
                      <button
                        className="button button-primary"
                        onClick={() => { setSelectedVenue(null); setFormOpen(true); }}
                      >
                        <Plus size={16} /> New Booking
                      </button>
                    </div>
                  </div>

                  <section className="stats-grid">
                    <Stat icon={Building2} label="Campus venues" value={venues.filter((v) => v.is_active).length} sub="Active academic halls" tint="violet" />
                    <Stat icon={CalendarDays} label="Faculty requests" value={bookings.length} sub="Your submitted sessions" tint="blue" />
                    <Stat icon={Clock3} label="Awaiting review" value={pending.length} sub="Under admin review" tint="orange" />
                    <Stat icon={CheckCircle2} label="Confirmed bookings" value={approved.length} sub="Approved reservations" tint="green" />
                  </section>

                  <section className="section-block">
                    <div className="section-heading">
                      <div>
                        <h2>Available Seminar Halls & Auditoriums</h2>
                        <p>Facilities equipped with projectors, sound systems, and Wi-Fi.</p>
                      </div>
                      <button className="text-button" onClick={() => setPage("Explore venues")}>
                        View all <ArrowRight size={15} />
                      </button>
                    </div>
                    <VenueGrid
                      venues={venues.filter((v) => v.is_active).slice(0, 3)}
                      onViewDetails={(v) => setSelectedDetailVenue(v)}
                      onBook={(v) => handleStartBookingForVenue(v)}
                    />
                  </section>

                  <section className="section-block recent-section">
                    <div className="section-heading">
                      <div>
                        <h2>Recent Faculty Booking Requests</h2>
                        <p>Private submission history for your classes and departmental events.</p>
                      </div>
                      <button className="text-button" onClick={() => setPage("My bookings")}>
                        View all <ArrowRight size={15} />
                      </button>
                    </div>
                    <BookingTable
                      bookings={bookings.slice(0, 5)}
                      onCancel={cancelOwnBooking}
                      currentUserId={user?.id}
                      isAdmin={false}
                      compact
                    />
                  </section>
                </>
              )}

              {/* ADMIN DEFAULT REDIRECT */}
              {isAdmin && (
                <div style={{ textAlign: "center", padding: "40px" }}>
                  <p>Redirecting to Administrator Control Center...</p>
                  <button className="button button-primary" onClick={() => setPage("Admin Approvals")}>
                    Open Control Center
                  </button>
                </div>
              )}
            </>
          )}

          {/* ========================================================== */}
          {/* PAGE: EXPLORE VENUES */}
          {/* ========================================================== */}
          {page === "Explore venues" && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> CAMPUS INVENTORY</div>
                  <h1>Explore Venues</h1>
                  <p>Browse campus auditoriums, seminar halls, and project labs with verified capacities and equipment.</p>
                </div>
                {isAdmin && (
                  <button className="button button-primary" onClick={openAddVenue}>
                    <Plus size={16} /> Add Venue
                  </button>
                )}
              </section>

              <div className="filter-bar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search venue name, category, or location..."
                  />
                </div>
                <div className="select-wrap">
                  <Filter size={16} />
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                    <option>All venues</option>
                    {[...new Set(venues.map((v) => v.category))].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
                <span className="results-count">{filteredVenues.length} spaces available</span>
              </div>

              <VenueGrid
                venues={filteredVenues}
                isAdmin={isAdmin}
                onEditVenue={openEditVenue}
                onToggleActive={toggleVenueActive}
                onViewDetails={(v) => setSelectedDetailVenue(v)}
                onBook={(v) => handleStartBookingForVenue(v)}
              />
            </>
          )}

          {/* ========================================================== */}
          {/* PAGE: MY BOOKINGS */}
          {/* ========================================================== */}
          {page === "My bookings" && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> BOOKING HISTORY</div>
                  <h1>My Bookings</h1>
                  <p>Track your submitted venue requests, approval status, and administrator feedback.</p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => {
                    setSelectedVenue(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus size={16} /> Request venue
                </button>
              </section>

              <section className="stats-grid mini-stats">
                <Stat icon={Activity} label="My requests" value={bookings.length} sub="Total history" tint="violet" />
                <Stat icon={Clock3} label="Pending" value={pending.length} sub="Under admin review" tint="orange" />
                <Stat icon={CheckCircle2} label="Approved" value={approved.length} sub="Confirmed reservation" tint="green" />
                <Stat icon={X} label="Rejected" value={rejected.length} sub="Requires rescheduling" tint="blue" />
              </section>

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Your submitted requests</h2>
                    <p>Real-time booking records from the college database.</p>
                  </div>
                  <button className="button button-secondary" onClick={loadData}>
                    <RefreshCw size={15} /> Refresh
                  </button>
                </div>

                <BookingTable
                  bookings={bookings}
                  onCancel={cancelOwnBooking}
                  currentUserId={user?.id}
                  isAdmin={false}
                />
              </div>
            </>
          )}

          {/* ========================================================== */}
          {/* PAGE: ADMIN CONTROL CENTER */}
          {/* ========================================================== */}
          {page === "Admin Approvals" && isAdmin && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> CAMPUS ADMINISTRATION</div>
                  <h1>Administrator Control Center</h1>
                  <p>Review booking requests with conflict prevention, manage campus venues, and audit actions.</p>
                </div>
                <div className="top-actions">
                  <button className="button button-secondary" onClick={loadData}>
                    <RefreshCw size={15} /> Refresh Data
                  </button>
                </div>
              </section>

              {/* Summary Metrics */}
              <section className="stats-grid mini-stats">
                <Stat icon={Clock3} label="Awaiting Approval" value={stats ? stats.pendingRequests : pending.length} sub="Pending review" tint="orange" />
                <Stat icon={CheckCircle2} label="Approved Bookings" value={stats ? stats.approvedBookings : approved.length} sub="Confirmed reservations" tint="green" />
                <Stat icon={X} label="Rejected Requests" value={stats ? stats.rejectedRequests : rejected.length} sub="Declined" tint="blue" />
                <Stat icon={Building2} label="Active Venues" value={stats ? stats.activeVenues : venues.filter((v) => v.is_active).length} sub="Bookable facilities" tint="violet" />
              </section>

              {/* Sub-Navigation */}
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-btn ${adminTab === "approvals" ? "active" : ""}`}
                  onClick={() => setAdminTab("approvals")}
                >
                  <ShieldCheck size={16} /> Booking Requests ({pending.length} Pending)
                </button>
                <button
                  className={`admin-subnav-btn ${adminTab === "venues" ? "active" : ""}`}
                  onClick={() => setAdminTab("venues")}
                >
                  <Building2 size={16} /> Venue Management ({venues.length})
                </button>
                <button
                  className={`admin-subnav-btn ${adminTab === "users" ? "active" : ""}`}
                  onClick={() => {
                    setAdminTab("users");
                    loadAdminExtras("users");
                  }}
                >
                  <Users size={16} /> User Directory & Provisioning
                </button>
                <button
                  className={`admin-subnav-btn ${adminTab === "logs" ? "active" : ""}`}
                  onClick={() => {
                    setAdminTab("logs");
                    loadAdminExtras("logs");
                  }}
                >
                  <FileText size={16} /> Security Audit Logs
                </button>
              </div>

              {/* TAB 1: BOOKING APPROVALS */}
              {adminTab === "approvals" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>All Campus Booking Requests</h2>
                      <p>Approvals automatically verify time overlap and lock confirmed reservation slots.</p>
                    </div>
                    <div className="select-wrap">
                      <select value={bookingStatusFilter} onChange={(e) => setBookingStatusFilter(e.target.value)}>
                        <option value="all">All statuses</option>
                        <option value="pending">Pending only</option>
                        <option value="approved">Approved only</option>
                        <option value="rejected">Rejected only</option>
                      </select>
                      <ChevronDown size={14} />
                    </div>
                  </div>

                  <BookingTable
                    bookings={bookings.filter((b) => bookingStatusFilter === "all" || b.status === bookingStatusFilter)}
                    onApprove={promptApprove}
                    onReject={promptReject}
                    isAdmin={true}
                  />
                </div>
              )}

              {/* TAB 2: VENUES MANAGEMENT */}
              {adminTab === "venues" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Campus Venues Inventory</h2>
                      <p>Create, update capacity, modify equipment, and toggle active status.</p>
                    </div>
                    <button className="button button-primary" onClick={openAddVenue}>
                      <Plus size={16} /> Add New Venue
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table className="booking-table">
                      <thead>
                        <tr>
                          <th>VENUE NAME</th>
                          <th>CATEGORY & LOCATION</th>
                          <th>CAPACITY</th>
                          <th>FACILITIES</th>
                          <th>STATUS</th>
                          <th>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {venues.map((v) => {
                          const vImg = getVenueImage(v);
                          return (
                            <tr key={v.id}>
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                  {vImg && (
                                    <img
                                      src={vImg}
                                      alt=""
                                      style={{ width: "36px", height: "36px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, border: "1px solid #eaebf2" }}
                                    />
                                  )}
                                  <strong>{v.name}</strong>
                                </div>
                              </td>
                              <td>{v.category} · {v.location}</td>
                              <td>{v.capacity} persons</td>
                              <td>{(v.facilities || []).join(", ") || "Standard"}</td>
                              <td>
                                <span className={`status status-${v.is_active ? "approved" : "rejected"}`}>
                                  <i />{v.is_active ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td>
                                <div className="action-pair">
                                  <button className="button button-secondary button-small" onClick={() => openEditVenue(v)}>
                                    Edit
                                  </button>
                                  <button
                                    className={`button button-small ${v.is_active ? "button-danger" : "button-primary"}`}
                                    onClick={() => toggleVenueActive(v)}
                                  >
                                    {v.is_active ? "Deactivate" : "Activate"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: USER PROVISIONING */}
              {adminTab === "users" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Authorized College Roster</h2>
                      <p>Manage pre-registered students (PRN) and faculty accounts.</p>
                    </div>
                    <button className="button button-primary" onClick={() => setUserModalOpen(true)}>
                      <UserPlus size={16} /> Provision User
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table className="booking-table">
                      <thead>
                        <tr>
                          <th>FULL NAME</th>
                          <th>ROLE</th>
                          <th>IDENTIFIER (PRN / EMAIL)</th>
                          <th>DEPARTMENT</th>
                          <th>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.map((u) => (
                          <tr key={u.id}>
                            <td><strong>{u.full_name}</strong></td>
                            <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                            <td>{u.prn ? `PRN: ${u.prn}` : u.email}</td>
                            <td>{u.department || "General"}</td>
                            <td>
                              <span className={`status status-${u.account_status === "active" ? "approved" : "rejected"}`}>
                                <i />{u.account_status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: AUDIT LOGS */}
              {adminTab === "logs" && (
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Security & Decision Audit Trail</h2>
                      <p>Immutable log of administrator approvals, rejections, and system changes.</p>
                    </div>
                    <button className="button button-secondary" onClick={() => loadAdminExtras("logs")}>
                      <RefreshCw size={15} /> Refresh Logs
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table className="booking-table">
                      <thead>
                        <tr>
                          <th>TIMESTAMP</th>
                          <th>ACTION</th>
                          <th>ADMINISTRATOR</th>
                          <th>TARGET ENTITY</th>
                          <th>DETAILS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.length === 0 ? (
                          <tr><td colSpan={5} style={{ textAlign: "center", padding: "20px" }}>No audit log entries found.</td></tr>
                        ) : (
                          auditLogs.map((log) => (
                            <tr key={log.id}>
                              <td>{new Date(log.created_at).toLocaleString("en-IN")}</td>
                              <td><strong>{log.action}</strong></td>
                              <td>{log.actor_name} ({log.actor_email})</td>
                              <td>{log.entity_type} · {log.entity_id}</td>
                              <td style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}>
                                <code>{log.details || "—"}</code>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================== */}
          {/* PAGE: PROFILE */}
          {/* ========================================================== */}
          {page === "Profile" && user && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> USER SETTINGS</div>
                  <h1>Account Profile</h1>
                  <p>View your institutional registration details and update your password.</p>
                </div>
              </section>

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Institutional Identity</h2>
                    <p>Verified through college roster records.</p>
                  </div>
                </div>

                <div className="profile-grid">
                  <div className="profile-field">
                    <span>Full Name</span>
                    <strong>{user.full_name}</strong>
                  </div>
                  <div className="profile-field">
                    <span>Authorized Role</span>
                    <strong>
                      <span className={`role-badge role-${user.role}`}>{user.role}</span>
                    </strong>
                  </div>
                  {user.prn && (
                    <div className="profile-field">
                      <span>Student PRN</span>
                      <strong>{user.prn}</strong>
                    </div>
                  )}
                  {user.email && (
                    <div className="profile-field">
                      <span>Registered Email</span>
                      <strong>{user.email}</strong>
                    </div>
                  )}
                  <div className="profile-field">
                    <span>Department</span>
                    <strong>{user.department || "Institutional"}</strong>
                  </div>
                  <div className="profile-field">
                    <span>Account Status</span>
                    <strong>
                      <span className="status status-approved"><i />{user.account_status}</span>
                    </strong>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--line)", paddingTop: "18px" }}>
                  <button className="button button-primary" onClick={() => setPasswordModalOpen(true)}>
                    <KeyRound size={16} /> Change Password
                  </button>
                </div>
              </div>
            </>
          )}

          <footer>
            <span>© {new Date().getFullYear()} MITAOE VenueBook · Campus Venue Management Portal</span>
            <span><span className="footer-dot" /> Built with real Supabase authentication and role-based access</span>
          </footer>
        </div>
      </main>

      {/* Global Modals for Authenticated Experience */}
      {renderModals()}
    </div>
  );

  // Helper to render modals cleanly across both views
  function renderModals() {
    return (
      <>
        {/* 1. AUTHENTICATION MODAL */}
        {authOpen && (
          <Modal
            title="MITAOE Campus Sign In"
            subtitle="Select your institutional role to access your dashboard."
            onClose={() => setAuthOpen(false)}
          >
            {/* Role Tabs */}
            <div className="auth-tabs">
              <button
                className={`auth-tab ${authRole === "student" ? "active" : ""}`}
                onClick={() => setAuthRole("student")}
              >
                <GraduationCap size={15} /> Student
              </button>
              <button
                className={`auth-tab ${authRole === "teacher" ? "active" : ""}`}
                onClick={() => setAuthRole("teacher")}
              >
                <School size={15} /> Teacher
              </button>
              <button
                className={`auth-tab ${authRole === "admin" ? "active" : ""}`}
                onClick={() => setAuthRole("admin")}
              >
                <ShieldCheck size={15} /> Administrator
              </button>
            </div>

            {/* Form based on role */}
            {authRole === "student" && (
              <StudentLoginForm
                loading={authLoading}
                onSubmit={handleStudentLogin}
                onRecover={() => { setAuthOpen(false); setRecoverModalOpen(true); }}
              />
            )}

            {authRole === "teacher" && (
              <TeacherLoginForm
                loading={authLoading}
                onSubmit={handleTeacherLogin}
                onRecover={() => { setAuthOpen(false); setRecoverModalOpen(true); }}
              />
            )}

            {authRole === "admin" && (
              <AdminLoginForm
                loading={authLoading}
                onSubmit={handleAdminLogin}
                onRecover={() => { setAuthOpen(false); setRecoverModalOpen(true); }}
              />
            )}

            {/* Quick Demo Pre-fills for Testing/Evaluation */}
            <div className="demo-credentials-box">
              <div className="demo-credentials-title">
                <KeyRound size={14} /> Quick Demo Logins for Evaluators:
              </div>
              <div className="demo-pill-group">
                <button
                  type="button"
                  className="demo-pill"
                  onClick={() => {
                    setAuthRole("student");
                    handleStudentLogin("PRN2024001", "Student@MITAOE2026");
                  }}
                >
                  Student (Aarav - PRN2024001)
                </button>
                <button
                  type="button"
                  className="demo-pill"
                  onClick={() => {
                    setAuthRole("teacher");
                    handleTeacherLogin("prof.sharma@mitaoe.ac.in", "Teacher@MITAOE2026");
                  }}
                >
                  Teacher (Prof. Sharma)
                </button>
                <button
                  type="button"
                  className="demo-pill"
                  onClick={() => {
                    setAuthRole("admin");
                    handleAdminLogin("admin@mitaoe.ac.in", "Admin@MITAOE2026");
                  }}
                >
                  Admin (Campus Admin)
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* 2. DEDICATED VENUE DETAILS MODAL ("Read More") */}
        {selectedDetailVenue && (
          <Modal
            title={selectedDetailVenue.name}
            subtitle={`${selectedDetailVenue.category} · ${selectedDetailVenue.location}`}
            onClose={() => setSelectedDetailVenue(null)}
          >
            <div className="venue-detail-modal-content">
              <div className="detail-hero-media">
                {getVenueImage(selectedDetailVenue) ? (
                  <img
                    src={getVenueImage(selectedDetailVenue)}
                    alt={`${selectedDetailVenue.name} - MITAOE Campus Venue`}
                    className="detail-hero-img"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <div className="detail-hero-scrim" />
                <div className="detail-hero-content">
                  <div>
                    <span className="role-badge role-student" style={{ background: "rgba(255, 255, 255, 0.95)", color: "var(--purple-dark)", fontWeight: 800 }}>
                      {selectedDetailVenue.category}
                    </span>
                    <h3 style={{ marginTop: "6px", color: "#ffffff", textShadow: "0 2px 10px rgba(0, 0, 0, 0.6)", fontSize: "22px", margin: "6px 0 4px" }}>
                      {selectedDetailVenue.name}
                    </h3>
                    <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", color: "#f3f4fd", textShadow: "0 1px 4px rgba(0, 0, 0, 0.5)" }}>
                      <MapPin size={13} /> {selectedDetailVenue.location}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="capacity-pill" style={{ background: "rgba(255, 255, 255, 0.95)", color: "#1c2035", fontWeight: 800, boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
                      <Users size={13} /> Max {selectedDetailVenue.capacity} seats
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <span className={`status status-${selectedDetailVenue.is_active ? "approved" : "rejected"}`} style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
                        <i />{selectedDetailVenue.is_active ? "Active & Bookable" : "Temporarily Inactive"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="detail-meta-row">
                <div className="detail-meta-cell">
                  <span>MAX CAPACITY</span>
                  <strong>{selectedDetailVenue.capacity} Persons</strong>
                </div>
                <div className="detail-meta-cell">
                  <span>BUILDING BLOCK</span>
                  <strong>{selectedDetailVenue.location}</strong>
                </div>
                <div className="detail-meta-cell">
                  <span>FACILITY STATUS</span>
                  <strong>{selectedDetailVenue.is_active ? "Operational" : "Under Maintenance"}</strong>
                </div>
              </div>

              <div>
                <div className="detail-section-title">VERIFIED FACILITIES & AMENITIES</div>
                <div className="facility-list" style={{ margin: "4px 0 0" }}>
                  {(selectedDetailVenue.facilities || []).map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="detail-section-title">VENUE DESCRIPTION</div>
                <p className="detail-description">
                  {selectedDetailVenue.description || "Official MITAOE campus hall allocated for academic lectures, technical symposia, and university meetings."}
                </p>
              </div>

              <div className="detail-rules-box">
                <strong><ShieldCheck size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} /> Booking Guidelines:</strong>
                <span>Requests must be submitted at least 24 hours in advance. Timings will be verified automatically by the backend conflict prevention engine before administrator approval.</span>
              </div>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setSelectedDetailVenue(null)}>
                  Close
                </button>
                {selectedDetailVenue.is_active && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => handleStartBookingForVenue(selectedDetailVenue)}
                  >
                    <CalendarDays size={16} /> Book This Venue
                  </button>
                )}
              </div>
            </div>
          </Modal>
        )}

        {/* 3. ADMIN DELIBERATE APPROVAL REVIEW MODAL */}
        {approvalReviewBooking && (
          <Modal
            title="Review & Confirm Venue Approval"
            subtitle="Verify event details before locking this schedule in Supabase PostgreSQL."
            onClose={() => setApprovalReviewBooking(null)}
          >
            <div style={{ display: "grid", gap: "14px" }}>
              <div className="review-dialog-grid">
                <div className="review-cell">
                  <span>EVENT TITLE</span>
                  <strong>{approvalReviewBooking.event_name}</strong>
                </div>
                <div className="review-cell">
                  <span>EVENT CATEGORY</span>
                  <strong>{approvalReviewBooking.event_type}</strong>
                </div>
                <div className="review-cell">
                  <span>CAMPUS VENUE</span>
                  <strong>{approvalReviewBooking.venue_name}</strong>
                </div>
                <div className="review-cell">
                  <span>STARTING DATE</span>
                  <strong>{fmtDate(approvalReviewBooking.start_date || approvalReviewBooking.event_date)}</strong>
                </div>
                <div className="review-cell">
                  <span>ENDING DATE</span>
                  <strong>{fmtDate(approvalReviewBooking.end_date || approvalReviewBooking.start_date || approvalReviewBooking.event_date)}</strong>
                </div>
                <div className="review-cell">
                  <span>RESERVATION WINDOW</span>
                  <strong>{fmtTime(approvalReviewBooking.start_time)} – {fmtTime(approvalReviewBooking.end_time)}</strong>
                </div>
                <div className="review-cell">
                  <span>EXPECTED ATTENDEES</span>
                  <strong>{approvalReviewBooking.attendee_count} attendees</strong>
                </div>
                <div className="review-cell review-full-width">
                  <span>REQUESTER INFORMATION</span>
                  <strong>
                    {approvalReviewBooking.requester_name} ({approvalReviewBooking.requester_role})
                    {approvalReviewBooking.requester_prn ? ` · PRN: ${approvalReviewBooking.requester_prn}` : ""}
                    {approvalReviewBooking.requester_email ? ` · ${approvalReviewBooking.requester_email}` : ""}
                  </strong>
                </div>
                {approvalReviewBooking.purpose && (
                  <div className="review-cell review-full-width">
                    <span>EVENT PURPOSE</span>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#555b77", lineHeight: "1.5" }}>
                      {approvalReviewBooking.purpose}
                    </p>
                  </div>
                )}
              </div>

              <div className="conflict-note-box">
                <ShieldCheck size={20} />
                <div>
                  <strong>Conflict Prevention Verified:</strong> Supabase PostgreSQL constraints guarantee that no conflicting approved reservations will exist for this venue during this timeslot.
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setApprovalReviewBooking(null)}>
                  Cancel
                </button>
                <button type="button" className="button button-primary" onClick={confirmApproval}>
                  <Check size={16} /> Confirm & Approve Request
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* 4. NEW BOOKING MODAL */}
        {formOpen && (
          <Modal
            title="Request a Venue"
            subtitle="Submit your event booking for administrator verification."
            onClose={() => setFormOpen(false)}
          >
            <form className="booking-form" onSubmit={submitBooking}>
              <label>
                Venue
                <select
                  required
                  value={form.venue_id}
                  onChange={(e) => setForm({ ...form, venue_id: e.target.value })}
                >
                  <option value="">Select a venue</option>
                  {venues.filter((v) => v.is_active).map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name} · max capacity {v.capacity} ({v.location})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Event Title
                <input
                  required
                  maxLength={100}
                  value={form.event_name}
                  onChange={(e) => setForm({ ...form, event_name: e.target.value })}
                  placeholder="e.g. Robotics Technical Symposium 2026"
                />
              </label>

              <div className="form-row">
                <label>
                  Event Type
                  <select
                    value={form.event_type}
                    onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                  >
                    {["Academic", "Workshop", "Seminar", "Cultural", "Sports", "Meeting", "Other"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Expected Attendees
                  <input
                    type="number"
                    min="1"
                    required
                    value={form.attendee_count}
                    onChange={(e) => setForm({ ...form, attendee_count: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Starting Date
                  <input
                    type="date"
                    required
                    min={futureDate(0)}
                    value={form.start_date || form.event_date}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        start_date: newStart,
                        event_date: newStart,
                        end_date: prev.end_date && prev.end_date < newStart ? newStart : prev.end_date || newStart
                      }));
                    }}
                  />
                </label>
                <label>
                  Ending Date
                  <input
                    type="date"
                    required
                    min={form.start_date || form.event_date || futureDate(0)}
                    value={form.end_date || form.start_date || form.event_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Start Time
                  <input
                    type="time"
                    required
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  />
                </label>
                <label>
                  End Time
                  <input
                    type="time"
                    required
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  />
                </label>
              </div>

              <label>
                Purpose & Requirements
                <textarea
                  rows={3}
                  required
                  maxLength={300}
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  placeholder="Explain event agenda, equipment requirements, or guest details..."
                />
              </label>

              <div className="approval-note">
                <Info size={18} />
                <div>
                  <strong>Admin Verification Policy:</strong> All submissions are held in Pending state until validated against university schedule conflicts.
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={loading}>
                  {loading ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} Submit Request
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* 5. REJECTION REASON MODAL (Admin) */}
        {rejectModalOpen && rejectTargetBooking && (
          <Modal
            title="Decline Booking Request"
            subtitle="Provide an official reason for the requester's records."
            onClose={() => setRejectModalOpen(false)}
          >
            <form
              className="booking-form"
              onSubmit={(e) => {
                e.preventDefault();
                confirmReject();
              }}
            >
              <div style={{ background: "#fbfbfd", padding: "12px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "11px" }}>
                <strong>Requester:</strong> {rejectTargetBooking.requester_name} ({rejectTargetBooking.requester_role})<br />
                <strong>Venue:</strong> {rejectTargetBooking.venue_name} ({fmtDateRange(rejectTargetBooking.start_date || rejectTargetBooking.event_date, rejectTargetBooking.end_date)}) [{fmtTime(rejectTargetBooking.start_time)} - {fmtTime(rejectTargetBooking.end_time)}]
              </div>

              <label>
                Official Rejection Reason (Mandatory)
                <textarea
                  required
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Facility is booked for university accreditation; please select alternate dates."
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setRejectModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-danger">
                  Confirm Rejection
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* 6. VENUE MANAGEMENT MODAL (Admin) */}
        {venueModalOpen && (
          <Modal
            title={venueForm.id ? "Edit Venue Details" : "Add Campus Venue"}
            subtitle="Configure venue capacity, location, and equipment."
            onClose={() => setVenueModalOpen(false)}
          >
            <form className="booking-form" onSubmit={saveVenue}>
              <label>
                Venue Name
                <input
                  required
                  value={venueForm.name}
                  onChange={(e) => setVenueForm({ ...venueForm, name: e.target.value })}
                  placeholder="e.g. Auditorium Hall C"
                />
              </label>

              <div className="form-row">
                <label>
                  Category
                  <select
                    value={venueForm.category}
                    onChange={(e) => setVenueForm({ ...venueForm, category: e.target.value })}
                  >
                    {["Auditorium", "Seminar Hall", "Meeting Room", "Event Room", "Common Space", "Lab"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Capacity (persons)
                  <input
                    type="number"
                    min="1"
                    required
                    value={venueForm.capacity}
                    onChange={(e) => setVenueForm({ ...venueForm, capacity: e.target.value })}
                  />
                </label>
              </div>

              <label>
                Building Location
                <input
                  required
                  value={venueForm.location}
                  onChange={(e) => setVenueForm({ ...venueForm, location: e.target.value })}
                  placeholder="e.g. Academic Block 2, Third Floor"
                />
              </label>

              <label>
                Facilities & Amenities (comma-separated)
                <input
                  value={venueForm.facilities}
                  onChange={(e) => setVenueForm({ ...venueForm, facilities: e.target.value })}
                  placeholder="Projector, Wi-Fi, Sound System, Podium"
                />
              </label>

              <label>
                Description
                <textarea
                  rows={2}
                  value={venueForm.description}
                  onChange={(e) => setVenueForm({ ...venueForm, description: e.target.value })}
                  placeholder="Brief description of the space..."
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setVenueModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary">
                  Save Venue
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* 7. USER PROVISIONING MODAL (Admin) */}
        {userModalOpen && (
          <Modal
            title="Provision Institutional User"
            subtitle="Add an authorized student or faculty account to the database."
            onClose={() => setUserModalOpen(false)}
          >
            <form className="booking-form" onSubmit={saveProvisionedUser}>
              <label>
                Full Name
                <input
                  required
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  placeholder="e.g. Pranav Deshmukh"
                />
              </label>

              <div className="form-row">
                <label>
                  Role
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  >
                    <option value="student">Student (PRN required)</option>
                    <option value="teacher">Teacher (Email required)</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>

                <label>
                  Department
                  <select
                    value={userForm.department}
                    onChange={(e) => setUserForm({ ...userForm, department: e.target.value })}
                  >
                    {["Computer Engineering", "Information Technology", "Electronics Engineering", "Mechanical Engineering", "Civil Engineering", "Campus Administration"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
              </div>

              {userForm.role === "student" ? (
                <label>
                  Student PRN (Permanent Registration Number)
                  <input
                    required
                    value={userForm.prn}
                    onChange={(e) => setUserForm({ ...userForm, prn: e.target.value })}
                    placeholder="e.g. PRN2024089"
                  />
                </label>
              ) : (
                <label>
                  Official College Email
                  <input
                    type="email"
                    required
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    placeholder="e.g. faculty.name@mitaoe.ac.in"
                  />
                </label>
              )}

              <label>
                Initial Secure Password
                <input
                  type="password"
                  required
                  minLength={6}
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="At least 6 characters"
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setUserModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary">
                  Provision Account
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* 8. NOTIFICATIONS DRAWER */}
        {notifOpen && (
          <Modal
            title="Campus Notifications"
            subtitle="Updates regarding your booking requests and administrative approvals."
            onClose={() => setNotifOpen(false)}
          >
            <div className="notif-list">
              {notifications.length === 0 ? (
                <div className="empty-state">
                  <Bell size={28} />
                  <strong>No notifications yet</strong>
                  <p>Status updates regarding your requests will appear here.</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`notif-item ${n.read ? "" : "unread"}`}>
                    <div className="notif-header">
                      <span>{n.title}</span>
                      <span className="notif-time">{new Date(n.created_at).toLocaleString("en-IN")}</span>
                    </div>
                    <p className="notif-text">{n.message}</p>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: "14px" }}>
              {notifications.some((n) => !n.read) && (
                <button
                  className="button button-secondary"
                  onClick={async () => {
                    await api.markNotificationsRead();
                    loadNotifications();
                  }}
                >
                  Mark all as read
                </button>
              )}
              <button className="button button-primary" onClick={() => setNotifOpen(false)}>
                Close
              </button>
            </div>
          </Modal>
        )}

        {/* 9. PASSWORD CHANGE MODAL */}
        {passwordModalOpen && (
          <Modal
            title="Change Password"
            subtitle="Update your password for institutional security."
            onClose={() => setPasswordModalOpen(false)}
          >
            <ChangePasswordForm
              onSubmit={async (currentPassword, newPassword) => {
                try {
                  await api.changePassword(currentPassword, newPassword);
                  setPasswordModalOpen(false);
                  setNotice("Password changed successfully.");
                } catch (err) {
                  setNotice(`Password change failed: ${err.message}`);
                }
              }}
              onClose={() => setPasswordModalOpen(false)}
            />
          </Modal>
        )}

        {/* 10. PASSWORD RECOVERY MODAL */}
        {recoverModalOpen && (
          <Modal
            title="Password Recovery"
            subtitle="Enter your PRN or registered college email address to receive password reset instructions."
            onClose={() => setRecoverModalOpen(false)}
          >
            <form
              className="booking-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const ident = e.target.identifier.value;
                try {
                  const res = await api.recoverPassword(ident);
                  setRecoverModalOpen(false);
                  setNotice(res.message);
                } catch (err) {
                  setNotice(err.message);
                }
              }}
            >
              <label>
                PRN or College Email
                <input
                  name="identifier"
                  required
                  placeholder="e.g. PRN2024001 or faculty@mitaoe.ac.in"
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setRecoverModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary">
                  Send Instructions
                </button>
              </div>
            </form>
          </Modal>
        )}
      </>
    );
  }
}

// ----------------- SUB-COMPONENTS -----------------

function Stat({ icon: Icon, label, value, sub, tint }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tint}`}><Icon size={19} /></div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </div>
  );
}

function VenueGrid({ venues, onBook, onViewDetails, isAdmin, onEditVenue, onToggleActive }) {
  if (!venues.length) {
    return (
      <div className="empty-state">
        <Building2 size={30} />
        <strong>No venues found</strong>
        <p>No venues match your current filter criteria.</p>
      </div>
    );
  }

  return (
    <div className="venue-grid">
      {venues.map((v, i) => {
        const Icon = v.category?.toLowerCase().includes("auditorium")
          ? Users
          : v.category?.toLowerCase().includes("meeting")
          ? Coffee
          : v.category?.toLowerCase().includes("seminar")
          ? Monitor
          : Building2;

        const venueImg = getVenueImage(v);

        return (
          <article className="venue-card" key={v.id}>
            <div className="venue-image-wrap">
              {venueImg ? (
                <img
                  src={venueImg}
                  alt={`${v.name} - MITAOE Campus Venue`}
                  className="venue-photo"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const fb = e.currentTarget.parentElement?.querySelector(".fallback-illustration");
                    if (fb) fb.style.display = "flex";
                  }}
                />
              ) : null}
              <div
                className={`venue-illustration fallback-illustration ${v.color || ["lavender", "blue", "mint", "peach"][i % 4]}`}
                style={{ display: venueImg ? "none" : "flex", width: "100%", height: "100%", position: "absolute", inset: 0 }}
              >
                <div className="venue-art-icon"><Icon size={45} strokeWidth={1.3} /></div>
                <div className="art-lines"><i /><i /><i /><i /></div>
              </div>
              <div className="venue-image-scrim" />
              <div className="illustration-top">
                <span className="venue-type">{v.category}</span>
                <span className="capacity-pill"><Users size={13} /> {v.capacity} max</span>
              </div>
            </div>
            <div className="venue-details">
              <h3>{v.name}</h3>
              <p className="venue-location"><MapPin size={14} /> {v.location}</p>
              <div className="facility-list">
                {(v.facilities || []).slice(0, 4).map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
              <div className="venue-card-bottom">
                <div>
                  <small>CAPACITY</small>
                  <strong>Up to {v.capacity}</strong>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {onViewDetails && (
                    <button
                      className="button button-secondary button-small"
                      onClick={() => onViewDetails(v)}
                      title="View complete specifications"
                    >
                      Details
                    </button>
                  )}
                  {isAdmin && onEditVenue && (
                    <button className="button button-secondary button-small" onClick={() => onEditVenue(v)}>
                      Edit
                    </button>
                  )}
                  {v.is_active ? (
                    <button className="button button-primary button-small" onClick={() => onBook(v)}>
                      Book venue <ArrowRight size={14} />
                    </button>
                  ) : (
                    <span className="status status-rejected">Inactive</span>
                  )}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function BookingTable({ bookings, onApprove, onReject, onCancel, currentUserId, isAdmin, compact = false }) {
  if (!bookings || bookings.length === 0) {
    return (
      <div className="empty-state">
        <CalendarDays size={28} />
        <strong>No booking requests recorded</strong>
        <p>Submitted venue requests will appear in this table.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="booking-table">
        <thead>
          <tr>
            <th>EVENT / VENUE</th>
            <th>DATE & TIME</th>
            <th>REQUESTER DETAILS</th>
            <th>ATTENDEES</th>
            <th>STATUS</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td>
                <div className="event-cell">
                  <strong>{b.event_name}</strong>
                  <span>{b.venue_name} ({b.venue_category || "Campus"})</span>
                </div>
              </td>
              <td>
                <div className="date-cell">
                  <strong>{fmtDateRange(b.start_date || b.event_date, b.end_date)}</strong>
                  <span>{fmtTime(b.start_time)} – {fmtTime(b.end_time)}</span>
                </div>
              </td>
              <td>
                <div className="requester-cell">
                  <span className="tiny-avatar">
                    {(b.requester_name || "U").slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{b.requester_name || "Campus User"}</strong>
                    <span style={{ display: "block", fontSize: "9px", color: "#8a8ea2" }}>
                      {b.requester_role ? (
                        <span className={`role-badge role-${b.requester_role}`}>{b.requester_role}</span>
                      ) : null}
                      {b.requester_prn ? ` · PRN: ${b.requester_prn}` : b.requester_email ? ` · ${b.requester_email}` : ""}
                    </span>
                  </div>
                </div>
              </td>
              <td><strong>{b.attendee_count}</strong></td>
              <td>
                <span className={statusClass(b.status)}><i />{b.status}</span>
                {b.status === "rejected" && b.rejection_reason && (
                  <span style={{ display: "block", fontSize: "9px", color: "#b94158", maxWidth: "200px", whiteSpace: "normal", marginTop: "3px" }}>
                    Reason: {b.rejection_reason}
                  </span>
                )}
                {b.status === "approved" && b.reviewer_name && (
                  <span style={{ display: "block", fontSize: "9px", color: "#1e825a", marginTop: "3px" }}>
                    Approved by {b.reviewer_name}
                  </span>
                )}
              </td>
              <td>
                {isAdmin && b.status === "pending" ? (
                  <div className="action-pair">
                    <button className="approve-button" onClick={() => onApprove(b)} title="Review and Approve">
                      <Check size={15} />
                    </button>
                    <button className="reject-button" onClick={() => onReject(b)} title="Decline Request">
                      <X size={15} />
                    </button>
                  </div>
                ) : !isAdmin && b.status === "pending" && currentUserId && b.requester_id === currentUserId && onCancel ? (
                  <button className="button button-danger button-small" onClick={() => onCancel(b)}>
                    Cancel
                  </button>
                ) : (
                  <span className="muted-dash">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button close-button" onClick={onClose}><X size={19} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// 1. Student Login Form (PRN + Password with Eye Toggle)
function StudentLoginForm({ loading, onSubmit, onRecover }) {
  const [prn, setPrn] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="booking-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(prn, password);
      }}
    >
      <label>
        Student PRN (Permanent Registration Number)
        <input
          required
          autoComplete="username"
          value={prn}
          onChange={(e) => setPrn(e.target.value)}
          placeholder="e.g. PRN2024001"
        />
      </label>
      <label>
        Student Password
        <div className="password-input-wrap">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter student password"
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <button className="button button-primary full-button" type="submit" disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />} Sign In as Student
      </button>
      <p className="auth-switch">
        Trouble signing in? <button type="button" onClick={onRecover}>Forgot password?</button>
      </p>
    </form>
  );
}

// 2. Teacher Login Form (College Email + Password with Eye Toggle)
function TeacherLoginForm({ loading, onSubmit, onRecover }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="booking-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(email, password);
      }}
    >
      <label>
        Assigned College Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. prof.sharma@mitaoe.ac.in"
        />
      </label>
      <label>
        Faculty Password
        <div className="password-input-wrap">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter teacher password"
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <button className="button button-primary full-button" type="submit" disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />} Sign In as Teacher
      </button>
      <p className="auth-switch">
        Trouble signing in? <button type="button" onClick={onRecover}>Forgot password?</button>
      </p>
    </form>
  );
}

// 3. Admin Login Form (Admin Email + Password with Eye Toggle)
function AdminLoginForm({ loading, onSubmit, onRecover }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="booking-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(email, password);
      }}
    >
      <label>
        Administrator Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. admin@mitaoe.ac.in"
        />
      </label>
      <label>
        Administrator Password
        <div className="password-input-wrap">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter administrator password"
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <button className="button button-primary full-button" type="submit" disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Administrator Sign In
      </button>
      <p className="auth-switch">
        Trouble signing in? <button type="button" onClick={onRecover}>Account assistance</button>
      </p>
    </form>
  );
}

// 4. Change Password Form with Eye Toggles
function ChangePasswordForm({ onSubmit, onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");

  return (
    <form
      className="booking-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
          setError("New password and confirmation do not match");
          return;
        }
        if (newPassword.length < 6) {
          setError("New password must be at least 6 characters");
          return;
        }
        setError("");
        onSubmit(currentPassword, newPassword);
      }}
    >
      <label>
        Current Password
        <div className="password-input-wrap">
          <input
            type={showCurrent ? "text" : "password"}
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowCurrent(!showCurrent)}
          >
            {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <label>
        New Password
        <div className="password-input-wrap">
          <input
            type={showNew ? "text" : "password"}
            required
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowNew(!showNew)}
          >
            {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <label>
        Confirm New Password
        <input
          type="password"
          required
          minLength={6}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button button-primary">
          Save New Password
        </button>
      </div>
    </form>
  );
}
