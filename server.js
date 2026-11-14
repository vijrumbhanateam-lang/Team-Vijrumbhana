
const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
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

// Static website files
app.use(express.static(path.join(__dirname, "public")));

// Environment variables
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const API_SECRET = process.env.API_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Multer configuration for optional photo/video
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      callback(null, true);
    } else {
      callback(new Error("Only image and video files are allowed."));
    }
  }
});

// Google Sheets connection
async function sheetsRequest(payload) {
  if (!GOOGLE_SCRIPT_URL || !API_SECRET) {
    throw new Error("Google Sheets configuration missing");
  }

  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...payload,
      secret: API_SECRET
    })
  });

  if (!response.ok) {
    throw new Error("Google Apps Script request failed");
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(
      result.message || "Google Sheets request failed"
    );
  }

  return result;
}

// Admin authentication
function adminAuth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Team Vijrumbhana server is running"
  });
});

// MEMBERSHIP SUBMISSION
app.post("/api/membership", async (req, res) => {
  try {
    const result = await sheetsRequest({
      action: "saveMembership",
      ...req.body
    });

    res.json(result);

  } catch (error) {
    console.error("Membership error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to save membership. Please try again."
    });
  }
});

// COMPLAINT SUBMISSION WITH OPTIONAL FILE
app.post("/api/complaint", (req, res, next) => {

  upload.single("attachment")(req, res, async (error) => {

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    try {

      const complaintData = {
        action: "saveComplaint",

        name: req.body.name,
        mobile: req.body.mobile,

        institutionType: req.body.institutionType,
        institutionName: req.body.institutionName,
        address: req.body.address,

        className: req.body.className || "",
        section: req.body.section || "",
        courseName: req.body.courseName || "",

        category: req.body.category,
        description: req.body.description,

        attachment: null
      };

      // Attach file only if user selected one
      if (req.file) {

        complaintData.attachment = {
          fileName: path.basename(req.file.originalname),
          mimeType: req.file.mimetype,
          base64: req.file.buffer.toString("base64")
        };

      }

      const result = await sheetsRequest(complaintData);

      res.json(result);

    } catch (error) {

      console.error("Complaint error:", error.message);

      res.status(500).json({
        success: false,
        message: "Unable to submit complaint. Please try again."
      });

    }

  });

});

// ADMIN LOGIN
app.post("/api/admin/login", (req, res) => {

  if (
    ADMIN_PASSWORD &&
    req.body.password === ADMIN_PASSWORD
  ) {

    req.session.admin = true;

    return res.json({
      success: true,
      message: "Login successful"
    });

  }

  res.status(401).json({
    success: false,
    message: "Invalid password"
  });

});

// ADMIN LOGOUT
app.post("/api/admin/logout", (req, res) => {

  req.session.destroy(() => {

    res.json({
      success: true
    });

  });

});

// GET MEMBERSHIPS
app.get("/api/admin/memberships", adminAuth, async (req, res) => {

  try {

    const result = await sheetsRequest({
      action: "getMemberships"
    });

    res.json(result.records || []);

  } catch (error) {

    console.error(error.message);

    res.status(500).json({
      success: false,
      message: "Unable to load memberships"
    });

  }

});

// GET COMPLAINTS
app.get("/api/admin/complaints", adminAuth, async (req, res) => {

  try {

    const result = await sheetsRequest({
      action: "getComplaints"
    });

    res.json(result.records || []);

  } catch (error) {

    console.error(error.message);

    res.status(500).json({
      success: false,
      message: "Unable to load complaints"
    });

  }

});

// UPDATE STATUS
app.post("/api/admin/status", adminAuth, async (req, res) => {

  try {

    const result = await sheetsRequest({
      action: "updateStatus",
      ...req.body
    });

    res.json(result);

  } catch (error) {

    console.error(error.message);

    res.status(500).json({
      success: false,
      message: "Unable to update status"
    });

  }

});

// EXPORT CSV
app.get("/api/admin/export/:type", adminAuth, async (req, res) => {

  try {

    const action =
      req.params.type === "memberships"
        ? "getMemberships"
        : "getComplaints";

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

    console.error("Export error:", error.message);

    res.status(500).send("Export failed");

  }

});

// Start server
app.listen(PORT, () => {

  console.log(
    `Team Vijrumbhana running on port ${PORT}`
  );

});
