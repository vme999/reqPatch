import test from "node:test";
import assert from "node:assert/strict";
import { formatRequestCopy } from "../lib/format.js";

test("formats a request and response for copying", () => {
  assert.equal(formatRequestCopy({
    url: "https://example.test/api",
    method: "POST",
    requestBody: '{"id":1}',
    responseBody: '{\n  "code": 500\n}'
  }), [
    "Request URL: https://example.test/api",
    "Request Method: POST",
    "Request Payload:",
    '{"id":1}',
    "Response Body:",
    "{",
    '  "code": 500',
    "}"
  ].join("\n"));
});

test("omits Request Payload when the request body is empty", () => {
  assert.equal(formatRequestCopy({
    url: "https://example.test/api",
    method: "GET",
    requestBody: "   ",
    responseBody: "ok"
  }), [
    "Request URL: https://example.test/api",
    "Request Method: GET",
    "Response Body:",
    "ok"
  ].join("\n"));
});
