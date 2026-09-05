require("dotenv").config();

const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 10000;

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  GROUPHUB_REGISTRATION_CODE
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Missing Supabase environment variables.");
}

const publicSupabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_ANON_KEY || "",
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket }
  }
);

const adminSupabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket }
  }
);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "SEE GroupHub" });
});

app.get("/api/config", (_req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL || "",
    supabaseAnonKey: SUPABASE_ANON_KEY || ""
  });
});

async function requireUser(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing access token." });

  const { data, error } = await publicSupabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "Invalid or expired session." });

  req.user = data.user;
  next();
}

async function requireAdmin(req, res, next) {
  await requireUser(req, res, async () => {
    const { data, error } = await adminSupabase
      .from("profiles")
      .select("id,email,full_name,gender,year_of_study,role,is_active")
      .eq("id", req.user.id)
      .single();

    if (error || !data || !["admin", "super_admin"].includes(data.role)) {
      return res.status(403).json({ error: "Admin access required." });
    }
    req.profile = data;
    next();
  });
}

app.get("/api/me", requireUser, async (req, res) => {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id,email,full_name,gender,year_of_study,role,is_active")
    .eq("id", req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/register", async (req, res) => {
  try {
    const { email, password, full_name, gender, year_of_study, registration_code } = req.body;

    if (!email || !password || !full_name || !gender || !year_of_study || !registration_code) {
      return res.status(400).json({ error: "All registration fields are required." });
    }

    if (!GROUPHUB_REGISTRATION_CODE || registration_code.trim() !== GROUPHUB_REGISTRATION_CODE) {
      return res.status(400).json({ error: "Invalid SEE GroupHub registration code." });
    }

    if (!["Female", "Male"].includes(gender)) {
      return res.status(400).json({ error: "Gender must be Female or Male." });
    }

    const { data, error } = await adminSupabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name.trim(),
        gender,
        year_of_study
      }
    });

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: "Account created successfully.", user: data.user });
  } catch (err) {
    res.status(500).json({ error: err.message || "Registration failed." });
  }
});

// Keep API routing before the SPA fallback.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SEE GroupHub listening on 0.0.0.0:${PORT}`);
});
