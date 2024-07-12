const express = require('express');
const multer = require('multer');
const dashboardController = require('./Controller/controller');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/upload', upload.single('csv'), dashboardController.uploadCSV);
router.get('/status/:id', dashboardController.checkStatus);

module.exports = router;
