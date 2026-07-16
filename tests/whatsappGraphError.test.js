const { extractWhatsAppGraphError } = require("../services/whatsappService");

const graphError = ({ status, type, code, subcode, message, details, fbtraceId }) => ({
  message: "Axios fallback message",
  response: {
    status,
    data: {
      error: {
        type,
        code,
        error_subcode: subcode,
        message,
        error_data: details ? { details } : undefined,
        fbtrace_id: fbtraceId
      }
    }
  },
  config: {
    headers: { Authorization: "Bearer EAA_NEVER_LOG_THIS" },
    data: { to: "50941111111", type: "template" }
  }
});

describe("safe WhatsApp Graph error diagnostics", () => {
  test.each([
    ["unknown template", 400, "OAuthException", 132001, 2494002],
    ["incorrect language", 400, "OAuthException", 132012, 2494010],
    ["missing parameter", 400, "OAuthException", 132000, 2494073],
    ["invalid token", 401, "OAuthException", 190, 463],
    ["invalid Phone Number ID", 400, "OAuthException", 100, 33],
    ["insufficient permissions", 403, "OAuthException", 10, 2018065]
  ])("extracts %s without request secrets", (_label, status, type, code, subcode) => {
    const diagnostic = extractWhatsAppGraphError(
      graphError({
        status,
        type,
        code,
        subcode,
        message: "Fictitious Meta error",
        details: "Fictitious diagnostic details",
        fbtraceId: "FICTIONAL_TRACE_ID"
      }),
      "template"
    );

    expect(diagnostic).toMatchObject({
      send_path: "template",
      http_status: status,
      meta_error_type: type,
      meta_error_code: String(code),
      meta_error_subcode: String(subcode),
      message: "Fictitious Meta error",
      error_data_details: "Fictitious diagnostic details",
      fbtrace_id: "FICTIONAL_TRACE_ID"
    });
    expect(diagnostic.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(diagnostic)).not.toContain("Authorization");
    expect(JSON.stringify(diagnostic)).not.toContain("EAA_NEVER_LOG_THIS");
    expect(JSON.stringify(diagnostic)).not.toContain("50941111111");
  });

  test("redacts tokens and complete phone numbers from Meta-controlled text", () => {
    const diagnostic = extractWhatsAppGraphError(
      graphError({
        status: 400,
        type: "OAuthException",
        code: 100,
        message: "Bearer EAAsecretToken rejected for 50941111111 and object 1234567890123456",
        details: "access_token=EAAanotherSecret&recipient=50942222222",
        fbtraceId: "FICTIONAL_TRACE_ID"
      }),
      "template"
    );
    const serialized = JSON.stringify(diagnostic);

    expect(serialized).not.toContain("EAAsecretToken");
    expect(serialized).not.toContain("EAAanotherSecret");
    expect(serialized).not.toContain("50941111111");
    expect(serialized).not.toContain("50942222222");
    expect(serialized).not.toContain("1234567890123456");
    expect(serialized).toContain("509******11");
    expect(serialized).toContain("509******22");
    expect(serialized).toContain("123******56");
  });

  test("does not expose unknown send paths", () => {
    const diagnostic = extractWhatsAppGraphError(new Error("Network unavailable"), "/secret");

    expect(diagnostic.send_path).toBe("unknown");
    expect(diagnostic.http_status).toBeNull();
    expect(diagnostic.message).toBe("Network unavailable");
  });
});
