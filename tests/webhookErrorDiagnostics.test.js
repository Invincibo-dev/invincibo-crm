const { webhookSignatureDiagnostics } = require("../middleware/errorHandler");

describe("WhatsApp webhook rejection diagnostics", () => {
  test("reports only safe signature and raw-body metadata", () => {
    const signature = `sha256=${"a".repeat(64)}`;
    const diagnostics = webhookSignatureDiagnostics({
      get: (name) => (name === "x-hub-signature-256" ? signature : undefined),
      rawBody: Buffer.from('{"sample":true}')
    });

    expect(diagnostics).toEqual({
      signature_header_present: true,
      signature_header_format_valid: true,
      raw_body_present: true,
      raw_body_bytes: 15
    });
    expect(JSON.stringify(diagnostics)).not.toContain(signature);
    expect(JSON.stringify(diagnostics)).not.toContain("sample");
  });

  test("handles missing headers and raw bodies without throwing", () => {
    expect(webhookSignatureDiagnostics({ get: () => undefined })).toEqual({
      signature_header_present: false,
      signature_header_format_valid: false,
      raw_body_present: false,
      raw_body_bytes: 0
    });
  });
});
