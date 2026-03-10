/**
 * Request validation for POST /api/v1/analyze-request
 */

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Validate the analyze-request payload.
 * Returns { valid: true } or { valid: false, code, message }.
 */
function validateAnalyzeRequest(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, code: 1003, message: "Invalid request: request body is not valid JSON" };
  }

  // Required fields
  if (!body.url) {
    return { valid: false, code: 1001, message: "Invalid request: 'url' is required" };
  }
  if (!body.method) {
    return { valid: false, code: 1001, message: "Invalid request: 'method' is required" };
  }
  if (!body.request_headers) {
    return { valid: false, code: 1001, message: "Invalid request: 'request_headers' is required" };
  }
  if (body.response_body === undefined || body.response_body === null) {
    return { valid: false, code: 1001, message: "Invalid request: 'response_body' is required" };
  }

  // Type checks
  if (typeof body.url !== 'string') {
    return { valid: false, code: 1002, message: "Invalid request: 'url' must be a string" };
  }
  if (typeof body.method !== 'string' || !VALID_METHODS.includes(body.method.toUpperCase())) {
    return { valid: false, code: 1002, message: "Invalid request: 'method' must be a valid HTTP method" };
  }
  if (typeof body.request_headers !== 'object' || Array.isArray(body.request_headers)) {
    return { valid: false, code: 1002, message: "Invalid request: 'request_headers' must be an object" };
  }
  if (typeof body.response_body !== 'string') {
    return { valid: false, code: 1002, message: "Invalid request: 'response_body' must be a string" };
  }

  // Optional field type checks
  if (body.query_params !== undefined && body.query_params !== null) {
    if (typeof body.query_params !== 'object' || Array.isArray(body.query_params)) {
      return { valid: false, code: 1002, message: "Invalid request: 'query_params' must be an object" };
    }
  }
  if (body.request_body !== undefined && body.request_body !== null) {
    if (typeof body.request_body !== 'object' || Array.isArray(body.request_body)) {
      return { valid: false, code: 1002, message: "Invalid request: 'request_body' must be an object" };
    }
  }

  return { valid: true };
}

module.exports = { validateAnalyzeRequest };
