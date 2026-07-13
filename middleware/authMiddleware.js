const jwt = require("jsonwebtoken");

const getTokenFromHeader = (authHeader) => {
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
};

const authenticateToken = (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT configuration error" });
    }

    const token = getTokenFromHeader(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ message: "Unauthorized: missing token" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Unauthorized: invalid token" });
  }
};

const optionalAuth = (req, _res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      return next();
    }
    const token = getTokenFromHeader(req.headers.authorization);
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
    }
  } catch (_error) {
    // Optional auth should not throw. Invalid token is ignored.
  }
  return next();
};

const authorizeRoles =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }
    return next();
  };

module.exports = {
  authenticateToken,
  optionalAuth,
  authorizeRoles
};
