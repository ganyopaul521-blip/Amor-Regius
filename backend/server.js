require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const mtn = require("./mtnMomo");
const mailer = require("./mailer");
const { EVENT_NAME, EVENT_SUBTITLE, ORG_NAME, EVENT_DATE_LINE } = require("./ticket");
const votesRouter = require("./routes/votes");
const ticketsRouter = require("./routes/tickets");
const adminRouter = require("./routes/admin");
const galleryRouter = require("./routes/gallery");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/api/config", (req, res) => {
  res.json({
    eventName: EVENT_NAME,
    eventSubtitle: EVENT_SUBTITLE,
    orgName: ORG_NAME,
    eventDateLine: EVENT_DATE_LINE,
    momoNumber: process.env.MOMO_NUMBER || "0558756757",
    votePriceGhs: Number(process.env.VOTE_PRICE_GHS || 1),
    mtnMomoConfigured: mtn.isConfigured(),
    emailConfigured: mailer.isConfigured(),
  });
});

app.use("/api/votes", votesRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/gallery", galleryRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`${EVENT_NAME} backend running on http://localhost:${PORT}`);
});
