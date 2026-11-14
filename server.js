const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "temporary-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const API_SECRET = process.env.API_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function sheetsRequest(payload) {
  if (!GOOGLE_SCRIPT_URL || !API_SECRET) {
    throw new Error("Google Sheets configuration missing");
  }

  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      secret: API_SECRET
    })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || "Google Sheets request failed");
  }

  return result;
}

function adminAuth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Team Vijrumbhana server is running" });
});

app.post("/api/membership", async (req, res) => {
  try {
    const result = await sheetsRequest({
      action: "saveMembership",
      ...req.body
    });
    res.json(result);
  } catch (error) {
    console.error("Membership error:", error.message);
    res.status(500).json({ success: false, message: "Unable to save membership. Please try again." });
  }
});

app.post("/api/complaint", async (req, res) => {
  try {
    const result = await sheetsRequest({
      action: "saveComplaint",
      ...req.body
    });
    res.json(result);
  } catch (error) {
    console.error("Complaint error:", error.message);
    res.status(500).json({ success: false, message: "Unable to submit complaint. Please try again." });
  }
});

app.post("/api/admin/login", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ success: true, message: "Login successful" });
  }
  res.status(401).json({ success: false, message: "Invalid password" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/admin/memberships", adminAuth, async (req, res) => {
  try {
    const result = await sheetsRequest({ action: "getMemberships" });
    res.json(result.records || []);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: "Unable to load memberships" });
  }
});

app.get("/api/admin/complaints", adminAuth, async (req, res) => {
  try {
    const result = await sheetsRequest({ action: "getComplaints" });
    res.json(result.records || []);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: "Unable to load complaints" });
  }
});

app.post("/api/admin/status", adminAuth, async (req, res) => {
  try {
    const result = await sheetsRequest({
      action: "updateStatus",
      ...req.body
    });
    res.json(result);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: "Unable to update status" });
  }
});

app.get("/api/admin/export/:type", adminAuth, async (req, res) => {
  try {
    const action =
      req.params.type === "memberships" ? "getMemberships" : "getComplaints";

    const result = await sheetsRequest({ action });
    const records = result.records || [];

    if (!records.length) {
      return res.status(404).send("No records available");
    }

    const headers = Object.keys(records[0]);
    const csv = [
      headers.join(","),
      ...records.map(row =>
        headers.map(header =>
          JSON.stringify(row[header] ?? "")
        ).join(",")
      )
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${req.params.type}.csv`
    );
    res.send(csv);
  } catch (error) {
    res.status(500).send("Export failed");
  }
});

app.listen(PORT, () => {
  console.log(`Team Vijrumbhana running on port ${PORT}`);
});
