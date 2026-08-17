/**
 * Single success envelope for the whole API. Controllers never call res.json
 * directly, so the frontend can rely on one shape for every 2xx response.
 */
class ApiResponse {
  constructor(statusCode, data = null, message = 'Success', meta = null) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    if (meta) this.meta = meta;
  }

  send(res) {
    return res.status(this.statusCode).json(this);
  }

  static ok(res, data, message = 'Success', meta) {
    return new ApiResponse(200, data, message, meta).send(res);
  }

  static created(res, data, message = 'Created successfully') {
    return new ApiResponse(201, data, message).send(res);
  }

  static noContent(res) {
    return res.status(204).send();
  }

  /** Paginated list responses carry their page state in `meta`. */
  static paginated(res, items, { page, limit, total }, message = 'Success') {
    return new ApiResponse(200, items, message, {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    }).send(res);
  }
}

export default ApiResponse;
