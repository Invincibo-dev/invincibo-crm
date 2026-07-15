module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testPathIgnorePatterns: ["/node_modules/", "/tests/mysqlStaging.integration.test.js"],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 65,
      lines: 65,
      statements: 65
    }
  }
};
