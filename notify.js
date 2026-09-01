// Sends a notification email via Resend's HTTP API (https://resend.com).
// No SDK needed — it's one fetch() call. Silently does nothing if
// RESEND_API_KEY isn't set, so forms still work (and still save to the
// database) without email configured.

async function sendNotification({ subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.NOTIFY_FROM;
  if (!apiKey || !to || !from) return { sent: false, reason: 'not configured' };

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to, subject, text })
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { sent: false, reason: body };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendNotification };
