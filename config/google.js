const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const peopleApi = google.people({
  version: "v1",
  auth: oauth2Client
});

module.exports = {
  oauth2Client,
  peopleApi
};
