// Sends the ticket email via the organizer's own Gmail account (Nodemailer
// SMTP) - no third-party email service, just a Gmail App Password.
// Setup: enable 2-Step Verification on the Gmail account, then create an
// App Password at https://myaccount.google.com/apppasswords and use it as
// GMAIL_APP_PASSWORD (not the normal Gmail login password).
const nodemailer = require("nodemailer");
const { EVENT_NAME, EVENT_SUBTITLE, ORG_NAME, EVENT_DATE_LINE, ticketIdFor } = require("./ticket");

function isConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

async function sendTicketEmail(order, pngBuffer) {
  if (!isConfigured()) {
    throw new Error("Email is not configured yet. Set GMAIL_USER and GMAIL_APP_PASSWORD in backend/.env.");
  }

  const ticketId = ticketIdFor(order.id);
  const ticketTypeLabel = order.ticket_type.charAt(0).toUpperCase() + order.ticket_type.slice(1);

  await getTransporter().sendMail({
    from: `"${EVENT_NAME}" <${process.env.GMAIL_USER}>`,
    to: order.buyer_email,
    subject: `Your ${EVENT_NAME} ticket (${ticketId})`,
    text: [
      `Hi ${order.buyer_name},`,
      "",
      `Your payment is confirmed! Here is your ticket for ${EVENT_NAME} - ${EVENT_SUBTITLE}.`,
      "",
      `Ticket ID: ${ticketId}`,
      `Type: ${ticketTypeLabel} x${order.quantity}`,
      `Date: ${EVENT_DATE_LINE}`,
      "",
      "Please bring this ticket (printed or on your phone) to the door - the QR code will be scanned for entry.",
      "",
      ORG_NAME,
    ].join("\n"),
    html: `
      <p>Hi ${order.buyer_name},</p>
      <p>Your payment is confirmed! Here is your ticket for <strong>${EVENT_NAME}</strong> — ${EVENT_SUBTITLE}.</p>
      <p>
        <strong>Ticket ID:</strong> ${ticketId}<br/>
        <strong>Type:</strong> ${ticketTypeLabel} x${order.quantity}<br/>
        <strong>Date:</strong> ${EVENT_DATE_LINE}
      </p>
      <p>Please bring this ticket (printed or on your phone) to the door — the QR code will be scanned for entry.</p>
      <p style="color:#7a6f5c;font-size:13px;">${ORG_NAME}</p>
    `,
    attachments: [{ filename: `${ticketId}.png`, content: pngBuffer, contentType: "image/png" }],
  });
}

module.exports = { isConfigured, sendTicketEmail };
