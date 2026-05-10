const express = require("express");
const actionController = require("../controllers/actionController");

const router = express.Router();

router.post("/students/:id/actions", actionController.createStudentAction);
router.get("/students/:id/actions", actionController.getStudentActions);

module.exports = router;