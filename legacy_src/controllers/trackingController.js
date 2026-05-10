const trackingService = require("../services/trackingService");

const handleTrackingRedirect = async (req, res, next) => {
  try {
    const { destination } = await trackingService.handleTrackingToken(req.params.token);
    return res.redirect(302, destination);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleTrackingRedirect
};
