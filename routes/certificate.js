const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getCertificate } = require('../controllers/bloodRequestController');

router.get('/:requestId', protect, getCertificate);

module.exports = router;
