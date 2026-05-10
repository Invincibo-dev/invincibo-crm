const express = require("express");
const studentController = require("../controllers/studentController");

const router = express.Router();

router.get("/students", studentController.getStudents);
router.post("/students", studentController.createStudent);
router.get("/students/:id", studentController.getStudentById);
router.patch("/students/:id/status", studentController.updateStudentStatus);

module.exports = router;