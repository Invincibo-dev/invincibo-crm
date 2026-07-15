process.env.NODE_ENV = "test";

const { buildTemplatePayload } = require("../services/whatsappService");

describe("WhatsApp approved template", () => {
  test("builds crm_followup_reminder with the first name in numeric variable 1", () => {
    expect(
      buildTemplatePayload({
        phone: "+509 37 00 00 99",
        firstName: "Jean",
        templateName: "crm_followup_reminder",
        templateLanguage: "fr"
      })
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "50937000099",
      type: "template",
      template: {
        name: "crm_followup_reminder",
        language: { code: "fr" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "Jean" }]
          }
        ]
      }
    });
  });
});
