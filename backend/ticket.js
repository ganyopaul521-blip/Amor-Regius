// Generates a printable/emailable ticket image (PNG) for a confirmed ticket
// order: event branding, buyer name, ticket type/quantity, the event date,
// a unique ticket ID, and a QR code encoding that ID for door verification.
const QRCode = require("qrcode");
const sharp = require("sharp");

const EVENT_NAME = "Amor Regius";
const EVENT_SUBTITLE = "Dinner & Awards Night";
const ORG_NAME = "ROYALHOUSE CHAPEL STUDENTS ASSOCIATION — UNIVERSITY OF GHANA";
const EVENT_DATE_LINE = "Sunday, 20th September 2026";
const EVENT_TIME = "5:00 PM";
const EVENT_VENUE = "Common Wealth Hall";

const NAVY = "#0f1f3d";
const GOLD = "#c9a227";
const GOLD_LIGHT = "#e8cf7a";
const CREAM = "#faf6ec";

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function ticketIdFor(orderId) {
  return `AR-${String(orderId).padStart(5, "0")}`;
}

function ticketTypeLabel(ticketType) {
  return ticketType.charAt(0).toUpperCase() + ticketType.slice(1);
}

async function buildSvg({ orderId, clientReference, buyerName, ticketType, quantity }) {
  const ticketId = ticketIdFor(orderId);
  const qrDataUrl = await QRCode.toDataURL(clientReference, {
    margin: 1,
    width: 260,
    color: { dark: NAVY, light: "#ffffff" },
  });

  const width = 1200;
  const height = 480;
  const stubX = width - 320;

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${CREAM}"/>
      <stop offset="100%" stop-color="#f3ead2"/>
    </linearGradient>
    <linearGradient id="goldText" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${GOLD}"/>
      <stop offset="50%" stop-color="${GOLD_LIGHT}"/>
      <stop offset="100%" stop-color="${GOLD}"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${GOLD}" stroke-width="3"/>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" fill="none" stroke="${GOLD}" stroke-width="1"/>

  <!-- corner flourishes -->
  <g stroke="${GOLD}" stroke-width="2" fill="none" opacity="0.8">
    <path d="M 28 70 Q 28 28 70 28"/>
    <path d="M 28 90 Q 28 48 90 48" opacity="0.5"/>
    <path d="M ${stubX - 40} 70 Q ${stubX - 40} 28 ${stubX - 82} 28"/>
    <path d="M ${stubX - 40} 90 Q ${stubX - 40} 48 ${stubX - 62} 48" opacity="0.5"/>
  </g>

  <!-- org name -->
  <text x="60" y="66" font-family="Georgia, 'Times New Roman', serif" font-size="18" letter-spacing="1.5" fill="${NAVY}" font-weight="bold">${escapeXml(ORG_NAME)}</text>

  <!-- event title -->
  <text x="60" y="160" font-family="Georgia, 'Times New Roman', serif" font-size="72" fill="url(#goldText)" font-weight="bold" letter-spacing="4">${escapeXml(EVENT_NAME.toUpperCase())}</text>
  <text x="60" y="200" font-family="Georgia, 'Times New Roman', serif" font-size="26" fill="${NAVY}" letter-spacing="6">${escapeXml(EVENT_SUBTITLE.toUpperCase())}</text>

  <line x1="60" y1="222" x2="720" y2="222" stroke="${GOLD}" stroke-width="1.5"/>

  <!-- ticket details -->
  <text x="60" y="270" font-family="Georgia, serif" font-size="15" fill="#7a6f5c" letter-spacing="1">GUEST</text>
  <text x="60" y="300" font-family="Georgia, serif" font-size="30" fill="${NAVY}" font-weight="bold">${escapeXml(buyerName)}</text>

  <text x="60" y="345" font-family="Georgia, serif" font-size="15" fill="#7a6f5c" letter-spacing="1">TICKET TYPE</text>
  <text x="60" y="372" font-family="Georgia, serif" font-size="22" fill="${NAVY}">${escapeXml(ticketTypeLabel(ticketType))} &#215; ${quantity}</text>

  <text x="420" y="345" font-family="Georgia, serif" font-size="15" fill="#7a6f5c" letter-spacing="1">DATE</text>
  <text x="420" y="372" font-family="Georgia, serif" font-size="22" fill="${NAVY}">${escapeXml(EVENT_DATE_LINE)}</text>

  <text x="60" y="417" font-family="Georgia, serif" font-size="15" fill="#7a6f5c" letter-spacing="1">VENUE</text>
  <text x="60" y="444" font-family="Georgia, serif" font-size="22" fill="${NAVY}">${escapeXml(EVENT_VENUE)}</text>

  <text x="420" y="417" font-family="Georgia, serif" font-size="15" fill="#7a6f5c" letter-spacing="1">TIME</text>
  <text x="420" y="444" font-family="Georgia, serif" font-size="22" fill="${NAVY}">${escapeXml(EVENT_TIME)}</text>

  <!-- perforation -->
  <line x1="${stubX}" y1="0" x2="${stubX}" y2="${height}" stroke="${NAVY}" stroke-width="2" stroke-dasharray="10,10" opacity="0.5"/>
  <circle cx="${stubX}" cy="0" r="16" fill="${CREAM}" stroke="${GOLD}" stroke-width="2"/>
  <circle cx="${stubX}" cy="${height}" r="16" fill="${CREAM}" stroke="${GOLD}" stroke-width="2"/>

  <!-- stub -->
  <text x="${stubX + 40}" y="56" font-family="Georgia, serif" font-size="14" fill="${NAVY}" letter-spacing="1" font-weight="bold">ADMIT ONE</text>
  <image x="${stubX + 30}" y="80" width="240" height="240" href="${qrDataUrl}"/>
  <text x="${stubX + 40}" y="350" font-family="Georgia, serif" font-size="15" fill="#7a6f5c" letter-spacing="1">TICKET ID</text>
  <text x="${stubX + 40}" y="382" font-family="Georgia, serif" font-size="26" fill="${NAVY}" font-weight="bold" letter-spacing="1">${ticketId}</text>
</svg>`;
}

async function generateTicketPng(order) {
  const svg = await buildSvg({
    orderId: order.id,
    clientReference: order.client_reference,
    buyerName: order.buyer_name,
    ticketType: order.ticket_type,
    quantity: order.quantity,
  });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateTicketPng, ticketIdFor, EVENT_NAME, EVENT_SUBTITLE, ORG_NAME, EVENT_DATE_LINE, EVENT_TIME, EVENT_VENUE };
