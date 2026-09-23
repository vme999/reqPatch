export function formatRequestCopy(request) {
  const lines = [`Request URL: ${request.url}`, `Request Method: ${request.method}`];
  const requestBody = String(request.requestBody || "").trim();

  if (requestBody) lines.push("Request Payload:", request.requestBody);
  lines.push("Response Body:", request.responseBody || "");
  return lines.join("\n");
}
