const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getPagination = (query = {}) => {
  const requested = query.page !== undefined || query.limit !== undefined;
  const page = positiveInteger(query.page, 1);
  const limit = Math.min(positiveInteger(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  return { requested, page, limit, offset: (page - 1) * limit };
};

const paginatedPayload = (rows, count, pagination) => ({
  data: rows,
  pagination: {
    page: pagination.page,
    limit: pagination.limit,
    total: count,
    total_pages: Math.ceil(count / pagination.limit),
    has_next: pagination.page * pagination.limit < count,
    has_previous: pagination.page > 1
  }
});

const sendCollection = (res, rows, count, pagination) => {
  res.set("X-Pagination-Limit", String(pagination.limit));
  if (!pagination.requested) {
    res.set("X-Pagination-Deprecated", "Pass page and limit to receive pagination metadata");
    return res.json(rows);
  }
  return res.json(paginatedPayload(rows, count, pagination));
};

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, getPagination, paginatedPayload, sendCollection };
