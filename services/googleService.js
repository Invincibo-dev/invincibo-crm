const { peopleApi } = require("../config/google");

const addContactToGoogle = async (name, phone, email) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error("Google OAuth env vars are missing");
  }

  const names = name ? [{ displayName: name }] : undefined;
  const phoneNumbers = phone ? [{ value: phone, type: "mobile" }] : undefined;
  const emailAddresses = email ? [{ value: email }] : undefined;

  const response = await peopleApi.people.createContact({
    requestBody: {
      names,
      phoneNumbers,
      emailAddresses
    }
  });

  return response.data;
};

module.exports = {
  addContactToGoogle
};
