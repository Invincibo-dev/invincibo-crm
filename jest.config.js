module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 65,
      lines: 65,
      statements: 65
    }
  }
};
