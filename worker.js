/**
 * Kerala Cafe — Table Reservation Worker
 * Deploy to Cloudflare Workers (free tier)
 *
 * Environment variables to set in Cloudflare dashboard:
 *   EPOSNOW_API_KEY    — your EposNow API key
 *   EPOSNOW_API_SECRET — your EposNow API secret
 *
 * EposNow API docs: https://developer.eposnowhq.com/Docs/BookingIntroduction
 */

const EPOSNOW_BASE = 'https://api.eposnowhq.com/api/V4';

// Replace with your actual allowed origin (your website domain)
const ALLOWED_ORIGIN = 'https://www.keralacafe.com';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    if (request.method !== 'POST') {
      return corsResponse({ error: 'Method not allowed' }, 405, env);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse({ success: false, message: 'Invalid request body' }, 400, env);
    }

    const { fullName, email, phone, partySize, date, time, notes } = body;

    // Basic server-side validation
    if (!fullName || !email || !phone || !partySize || !date || !time) {
      return corsResponse({ success: false, message: 'Missing required fields' }, 400, env);
    }

    // Build Basic auth token from API key + secret
    const token = btoa(`${env.EPOSNOW_API_KEY}:${env.EPOSNOW_API_SECRET}`);
    const headers = {
      'Authorization': `Basic ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      // Step 1: Create or find customer in EposNow
      const customerId = await upsertCustomer({ fullName, email, phone }, headers);

      // Step 2: Create the booking in EposNow
      const bookingDateTime = `${date}T${time}:00`;

      const bookingPayload = {
        CustomerId:   customerId,
        Name:         fullName,
        Covers:       parseInt(partySize, 10),
        StartTime:    bookingDateTime,
        Notes:        notes || '',
        StatusId:     1, // 1 = Confirmed — check your EposNow setup for correct status IDs
      };

      const bookingRes = await fetch(`${EPOSNOW_BASE}/Booking`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(bookingPayload),
      });

      if (!bookingRes.ok) {
        const errText = await bookingRes.text();
        console.error('EposNow booking error:', errText);
        return corsResponse({ success: false, message: 'Could not create booking in EposNow' }, 502, env);
      }

      const booking = await bookingRes.json();

      return corsResponse({
        success:   true,
        bookingId: booking.Id ?? booking.id ?? null,
        message:   'Reservation confirmed',
      }, 200, env);

    } catch (err) {
      console.error('Worker error:', err);
      return corsResponse({ success: false, message: 'Internal error' }, 500, env);
    }
  },
};

// Upsert customer — search first, create if not found
async function upsertCustomer({ fullName, email, phone }, headers) {
  const searchRes = await fetch(
    `${EPOSNOW_BASE}/Customer?email=${encodeURIComponent(email)}`,
    { headers }
  );

  if (searchRes.ok) {
    const results = await searchRes.json();
    if (Array.isArray(results) && results.length > 0) {
      return results[0].Id ?? results[0].id;
    }
  }

  // Customer not found — create
  const [FirstName, ...rest] = fullName.trim().split(' ');
  const LastName = rest.join(' ') || '-';

  const createRes = await fetch(`${EPOSNOW_BASE}/Customer`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ FirstName, LastName, Email: email, Phone: phone }),
  });

  if (!createRes.ok) {
    throw new Error('Failed to create customer in EposNow');
  }

  const customer = await createRes.json();
  return customer.Id ?? customer.id;
}

function corsResponse(body, status, env) {
  const origin = ALLOWED_ORIGIN;
  const headers = {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  return new Response(
    body !== null ? JSON.stringify(body) : null,
    { status, headers }
  );
}
