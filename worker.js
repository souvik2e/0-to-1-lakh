// ================================================================
// CLOUDFLARE WORKER — Creator Blueprint Payment Backend
// ================================================================
// DEPLOY STEPS:
// 1. Cloudflare Dashboard → Workers & Pages → Create Worker
// 2. Paste this entire file → Save & Deploy
// 3. Settings → Variables → Add these 3 variables:
//    CASHFREE_APP_ID     = (your App ID from Cashfree dashboard)
//    CASHFREE_SECRET_KEY = (your Secret Key from Cashfree dashboard)
//    CASHFREE_ENV        = production
// 4. Copy your Worker URL (shown after deploy) → paste it in
//    index.html and success.html where it says WORKER_URL
// ================================================================

// ── REAL PDF LINKS (Google Drive direct share links) ──
var PDF_PHASE1  = "https://drive.google.com/file/d/1F22J4AhxoBV1StZJMu_fCktFHWMrnwdL/view?usp=drive_link";
var PDF_PHASE2A = "https://drive.google.com/file/d/1P7f7f0PxRZkAPAduYiFz6fMBXKviOkzQ/view?usp=drive_link";
var PDF_PHASE2B = "https://drive.google.com/file/d/10ynNR7n55W2WAeJ8g4hmbr4yzEdFNGOe/view?usp=drive_link";

// ── CORS HEADERS ──
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS),
  });
}

function getBase(env) {
  var mode = (env && env.CASHFREE_ENV) ? env.CASHFREE_ENV : "sandbox";
  return mode === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

function getEnv(event) {
  // Cloudflare Workers exposes env vars as globals
  try {
    return {
      CASHFREE_APP_ID:     typeof CASHFREE_APP_ID     !== "undefined" ? CASHFREE_APP_ID     : "",
      CASHFREE_SECRET_KEY: typeof CASHFREE_SECRET_KEY !== "undefined" ? CASHFREE_SECRET_KEY : "",
      CASHFREE_ENV:        typeof CASHFREE_ENV        !== "undefined" ? CASHFREE_ENV        : "sandbox",
    };
  } catch(e) {
    return { CASHFREE_APP_ID: "", CASHFREE_SECRET_KEY: "", CASHFREE_ENV: "sandbox" };
  }
}

// ── CREATE ORDER ──
async function handleCreateOrder(request, env) {
  var body;
  try { body = await request.json(); } catch(e) { body = {}; }

  var orderId = "bp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  var email   = (body.email && body.email.indexOf("@") > 0) ? body.email : "buyer@email.com";
  var rawPhone = String(body.phone || "").replace(/\D/g, "");
  var phone   = rawPhone.length === 10 ? rawPhone : "9999999999";
  var name    = body.name || "Buyer";

  var payload = {
    order_id: orderId,
    order_amount: 299,
    order_currency: "INR",
    customer_details: {
      customer_id: "cust_" + Date.now(),
      customer_email: email,
      customer_phone: phone,
      customer_name: name,
    },
    order_meta: {
      // IMPORTANT: After payment Cashfree redirects here with order_id filled in
      // Replace YOUR_GITHUB_USERNAME and YOUR_REPO_NAME with your actual values
      return_url: "https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/success.html?order_id={order_id}",
    },
    order_note: "Creator Blueprint — Complete PDF Guide (3 phases)",
  };

  var resp;
  try {
    resp = await fetch(getBase(env) + "/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id":     env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY,
        "x-api-version":   "2023-08-01",
      },
      body: JSON.stringify(payload),
    });
  } catch(e) {
    return jsonResp({ error: "Network error contacting Cashfree: " + e.message }, 500);
  }

  var data;
  try { data = await resp.json(); } catch(e) {
    return jsonResp({ error: "Bad response from Cashfree" }, 500);
  }

  if (!data.payment_session_id) {
    return jsonResp({ error: "Cashfree did not return session ID", details: data }, 500);
  }

  return jsonResp({
    payment_session_id: data.payment_session_id,
    order_id: data.order_id,
  });
}

// ── VERIFY PAYMENT ──
// Called by success.html after Cashfree redirects back
// ONLY returns PDF links if Cashfree confirms order_status = "PAID"
async function handleVerifyPayment(request, env) {
  var url     = new URL(request.url);
  var orderId = url.searchParams.get("order_id");

  if (!orderId) {
    return jsonResp({ success: false, error: "No order_id provided" }, 400);
  }

  var resp;
  try {
    resp = await fetch(getBase(env) + "/orders/" + orderId, {
      method: "GET",
      headers: {
        "x-client-id":     env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY,
        "x-api-version":   "2023-08-01",
      },
    });
  } catch(e) {
    return jsonResp({ success: false, error: "Network error: " + e.message }, 500);
  }

  var data;
  try { data = await resp.json(); } catch(e) {
    return jsonResp({ success: false, error: "Bad response from Cashfree" }, 500);
  }

  // ── ONLY RETURN PDF LINKS IF PAYMENT IS CONFIRMED PAID ──
  if (data.order_status === "PAID") {
    return jsonResp({
      success: true,
      order_id: orderId,
      amount:   data.order_amount,
      links: {
        phase1:  PDF_PHASE1,
        phase2a: PDF_PHASE2A,
        phase2b: PDF_PHASE2B,
      },
    });
  }

  // Payment not complete — return status without links
  return jsonResp({
    success: false,
    status:  data.order_status || "UNKNOWN",
    error:   "Payment not confirmed",
  });
}

// ── MAIN FETCH HANDLER ──
addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  var env = getEnv();
  var url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // POST /create-order → create a Cashfree order, return session ID
  if (request.method === "POST" && url.pathname === "/create-order") {
    return handleCreateOrder(request, env);
  }

  // GET /verify-payment?order_id=xxx → verify with Cashfree, return PDF links only if PAID
  if (request.method === "GET" && url.pathname === "/verify-payment") {
    return handleVerifyPayment(request, env);
  }

  // Health check
  return new Response(
    JSON.stringify({ status: "Worker is running", endpoints: ["/create-order (POST)", "/verify-payment (GET)"] }),
    { status: 200, headers: Object.assign({ "Content-Type": "application/json" }, CORS) }
  );
}
