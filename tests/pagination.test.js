const { getPagination, paginatedPayload, MAX_LIMIT } = require("../services/pagination");

describe("pagination", () => {
  test("uses bounded defaults for legacy collection requests", () => {
    expect(getPagination({})).toEqual({ requested: false, page: 1, limit: 100, offset: 0 });
  });

  test("caps client limits and calculates offsets", () => {
    expect(getPagination({ page: "3", limit: "9999" })).toEqual({
      requested: true,
      page: 3,
      limit: MAX_LIMIT,
      offset: MAX_LIMIT * 2
    });
  });

  test("returns stable pagination metadata", () => {
    expect(paginatedPayload([{ id: 1 }], 11, { page: 2, limit: 10 })).toEqual({
      data: [{ id: 1 }],
      pagination: {
        page: 2,
        limit: 10,
        total: 11,
        total_pages: 2,
        has_next: false,
        has_previous: true
      }
    });
  });
});
