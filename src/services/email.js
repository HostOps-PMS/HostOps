// src/services/email.js
import { Resend } from 'resend';

let _resend = null;
function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM = process.env.EMAIL_FROM || 'HostPilot <noreply@hostpilot.dev>';

// ── Base template ──────────────────────────────────────────────
function wrap(html, title = 'HostPilot') {
  return `
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8"><title>${title}</title></head>
      <body style="font-family: -apple-system, sans-serif; background:#eaf8f1; padding:32px; margin:0;">
        <div style="max-width:520px; margin:0 auto; background:#fff; border-radius:14px; padding:36px; box-shadow:0 4px 20px rgba(0,0,0,.05);">
          <div style="font-family:'Sora',sans-serif; font-weight:800; font-size:22px; color:#0c1c14; margin-bottom:24px;">
            🏠 HostPilot
          </div>
          ${html}
          <hr style="border:none; border-top:1px solid #e3ede8; margin:28px 0;">
          <p style="font-size:12px; color:#9ab8a9; margin:0;">
            If you didn't request this email, you can safely ignore it.
          </p>
        </div>
      </body>
    </html>
  `;
}

// ── Send email verification link ───────────────────────────────
export async function sendVerificationEmail(to, firstName, link) {
  const html = wrap(`
    <h1 style="font-size:22px; color:#0c1c14; margin:0 0 14px;">
      Welcome, ${firstName}! 👋
    </h1>
    <p style="color:#2a4e3c; line-height:1.6; margin:0 0 24px;">
      Please confirm your email address to activate your HostPilot account.
    </p>
    <a href="${link}" style="display:inline-block; padding:14px 28px; background:#26a676; color:#fff; text-decoration:none; border-radius:100px; font-weight:700; font-size:15px;">
      Verify my email →
    </a>
    <p style="color:#6a8b7c; font-size:13px; margin:24px 0 0;">
      This link expires in 24 hours.
    </p>
  `, 'Verify your email');

  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Verify your HostPilot account',
    html,
  });

  if (result.error) {
    throw new Error(result.error.message || 'Resend failed to send verification email');
  }

  console.log('Verification email sent:', result.data?.id);
  return result;
}

// ── Send password reset link ───────────────────────────────────
export async function sendResetEmail(to, firstName, link) {
  const html = wrap(`
    <h1 style="font-size:22px; color:#0c1c14; margin:0 0 14px;">
      Reset your password
    </h1>
    <p style="color:#2a4e3c; line-height:1.6; margin:0 0 24px;">
      Hi ${firstName}, we got a request to reset your HostPilot password. Click below to set a new one.
    </p>
    <a href="${link}" style="display:inline-block; padding:14px 28px; background:#26a676; color:#fff; text-decoration:none; border-radius:100px; font-weight:700; font-size:15px;">
      Reset my password →
    </a>
    <p style="color:#6a8b7c; font-size:13px; margin:24px 0 0;">
      This link expires in 1 hour. If you didn't request this, ignore the email.
    </p>
  `, 'Reset your password');

  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Reset your HostPilot password',
    html,
  });

  if (result.error) {
    throw new Error(result.error.message || 'Resend failed to send verification email');
  }

  console.log('Verification email sent:', result.data?.id);
  return result;
}