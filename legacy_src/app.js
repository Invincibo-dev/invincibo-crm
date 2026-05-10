const express = require("express");
const routes = require("./routes");
const trackingRoutes = require("./routes/trackingRoutes");
const { notFound } = require("./middlewares/notFound");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "activation-engine", status: "ok" });
});

app.use(trackingRoutes);
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
