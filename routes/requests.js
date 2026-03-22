const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const Donor = require('../models/Donor');
const { protect } = require('../middleware/auth');
const {
  createRequest,
  getDonorRequests,
  getReceiverRequests,
  acceptRequest,
  completeRequest
} = require('../controllers/bloodRequestController');

router.post('/create', protect, createRequest);
router.get('/donor', protect, getDonorRequests);
router.get('/receiver', protect, getReceiverRequests);

// @route   GET /api/requests
// @desc    Get all active blood requests (with optional filters)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { bloodGroup, city, state, urgency, status } = req.query;

    // Build query
    const query = {};

    if (status) {
      query.status = status;
    }

    if (bloodGroup) {
      query.bloodGroup = bloodGroup;
    }

    if (city) {
      query['hospitalAddress.city'] = new RegExp(city, 'i');
    }

    if (state) {
      query['hospitalAddress.state'] = new RegExp(state, 'i');
    }

    if (urgency) {
      query.urgency = urgency;
    }

    const requests = await Request.find(query)
      .populate('user', 'name email phone')
      .populate('acceptedDonor', 'name bloodGroup phone')
      .populate('fulfilledBy', 'name bloodGroup phone')
      .sort('-createdAt');

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching blood requests' 
    });
  }
});

// @route   GET /api/requests/my-requests
// @desc    Get logged-in user's blood requests
// @access  Private
router.get('/my-requests', protect, async (req, res) => {
  try {
    const requests = await Request.find({ user: req.user._id })
      .populate('acceptedDonor', 'name bloodGroup phone')
      .populate('fulfilledBy', 'name bloodGroup phone')
      .sort('-createdAt');

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    console.error('Get my requests error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching your requests' 
    });
  }
});

// @route   GET /api/requests/nearby
// @desc    Get nearby blood requests (for donors)
// @access  Private (Donor)
router.get('/nearby', protect, async (req, res) => {
  try {
    // Get donor profile to find their location
    const donor = await Donor.findOne({ user: req.user._id });

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found. Please create your donor profile first.'
      });
    }

    const { radius } = req.query; // radius in km
    const maxRadius = radius ? parseFloat(radius) : 50; // default 50km

    // Get all active requests
    let requests = await Request.find({ status: 'requested' })
      .populate('user', 'name email phone')
      .sort('-urgency -createdAt');

    // Filter requests matching donor's blood group or compatible
    const compatibleBloodGroups = {
      'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
      'O+': ['O+', 'A+', 'B+', 'AB+'],
      'A-': ['A-', 'A+', 'AB-', 'AB+'],
      'A+': ['A+', 'AB+'],
      'B-': ['B-', 'B+', 'AB-', 'AB+'],
      'B+': ['B+', 'AB+'],
      'AB-': ['AB-', 'AB+'],
      'AB+': ['AB+']
    };

    requests = requests.filter(request => 
      compatibleBloodGroups[donor.bloodGroup]?.includes(request.bloodGroup)
    );

    // Calculate distance if coordinates available
    if (donor.address.coordinates && donor.address.coordinates.lat && donor.address.coordinates.lng) {
      requests = requests.map(request => {
        if (request.hospitalAddress.coordinates && 
            request.hospitalAddress.coordinates.lat && 
            request.hospitalAddress.coordinates.lng) {
          const distance = Donor.calculateDistance(
            donor.address.coordinates.lat,
            donor.address.coordinates.lng,
            request.hospitalAddress.coordinates.lat,
            request.hospitalAddress.coordinates.lng
          );
          return {
            ...request.toObject(),
            distance: distance.toFixed(2)
          };
        }
        return request.toObject();
      });

      // Filter by radius
      requests = requests.filter(request => 
        !request.distance || parseFloat(request.distance) <= maxRadius
      );

      // Sort by urgency and distance
      requests.sort((a, b) => {
        const urgencyOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        return (a.distance || Infinity) - (b.distance || Infinity);
      });
    }

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    console.error('Get nearby requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching nearby requests'
    });
  }
});

// @route   GET /api/requests/:id
// @desc    Get single blood request by ID
// @access  Private
router.get('/:id([0-9a-fA-F]{24})', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('acceptedDonor', 'name bloodGroup phone address')
      .populate('fulfilledBy', 'name bloodGroup phone address')
      .populate('responses.donorId', 'name bloodGroup phone');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Increment view count
    request.viewCount += 1;
    await request.save();

    res.json({
      success: true,
      request
    });
  } catch (error) {
    console.error('Get request error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error fetching blood request'
    });
  }
});

// @route   POST /api/requests
// @desc    Create new blood request
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    // Required fields validation
    const { patientName, bloodGroup, unitsRequired, hospitalName, hospitalAddress, contactPerson, requiredBy } = req.body;

    if (!patientName || !bloodGroup || !unitsRequired || !hospitalName || !hospitalAddress || !contactPerson || !requiredBy) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    if (!hospitalAddress.street || !hospitalAddress.city || !hospitalAddress.state || !hospitalAddress.pincode) {
      return res.status(400).json({
        success: false,
        message: 'Please provide complete hospital address'
      });
    }

    if (!contactPerson.name || !contactPerson.phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide contact person name and phone'
      });
    }

    // Validate required date is in future
    const reqDate = new Date(requiredBy);
    if (reqDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Required date must be in the future'
      });
    }

    const requestData = {
      ...req.body,
      user: req.user._id,
      status: 'requested'
    };

    const request = await Request.create(requestData);

    // Populate user data
    await request.populate('user', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Blood request created successfully',
      request
    });
  } catch (error) {
    console.error('Create request error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Server error creating blood request' 
    });
  }
});

// @route   PUT /api/requests/:id
// @desc    Update blood request
// @access  Private (Only request creator)
router.put('/:id([0-9a-fA-F]{24})', protect, async (req, res) => {
  try {
    let request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (request.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'You can only update your own requests' 
      });
    }

    // Cannot update fulfilled or cancelled requests
    if (request.status === 'completed' || request.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot update ${request.status.toLowerCase()} request`
      });
    }

    // Validate required date if updating
    if (req.body.requiredBy) {
      const reqDate = new Date(req.body.requiredBy);
      if (reqDate < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Required date must be in the future'
        });
      }
    }

    request = await Request.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('user', 'name email phone');

    res.json({
      success: true,
      message: 'Blood request updated successfully',
      request
    });
  } catch (error) {
    console.error('Update request error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating blood request'
    });
  }
});

// @route   PUT /api/requests/:id/cancel
// @desc    Cancel blood request
// @access  Private (Only request creator)
router.put('/:id([0-9a-fA-F]{24})/cancel', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (request.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'You can only cancel your own requests' 
      });
    }

    // Cannot cancel already fulfilled or cancelled requests
    if (request.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed request'
      });
    }

    if (request.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Request is already cancelled'
      });
    }

    if (request.status === 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel an already accepted request'
      });
    }

    request.status = 'Cancelled';
    await request.save();

    res.json({
      success: true,
      message: 'Blood request cancelled successfully',
      request
    });
  } catch (error) {
    console.error('Cancel request error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error cancelling blood request'
    });
  }
});

// @route   PUT /api/requests/:id/fulfill
// @desc    Mark blood request as fulfilled
// @access  Private (Request creator or donor)
router.put('/:id([0-9a-fA-F]{24})/fulfill', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Only request creator can mark as fulfilled
    if (request.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only request creator can mark request as fulfilled'
      });
    }

    if (request.status !== 'accepted' || !request.acceptedDonor) {
      return res.status(400).json({
        success: false,
        message: 'Only accepted requests can be fulfilled'
      });
    }

    request.status = 'completed';
    request.completedAt = Date.now();
    request.fulfilledAt = request.completedAt;
    request.fulfilledBy = request.acceptedDonor;

    const donor = await Donor.findById(request.acceptedDonor);
    if (donor) {
      donor.donationCount += 1;
      donor.lastDonationDate = request.completedAt;
      await donor.save();
    }

    await request.save();

    await request.populate([
      { path: 'user', select: 'name email phone' },
      { path: 'acceptedDonor', select: 'name bloodGroup phone' },
      { path: 'fulfilledBy', select: 'name bloodGroup phone' }
    ]);

    res.json({
      success: true,
      message: 'Blood request marked as fulfilled',
      request
    });
  } catch (error) {
    console.error('Fulfill request error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error fulfilling blood request'
    });
  }
});

// @route   POST /api/requests/:id/respond
// @desc    Donor responds to blood request
// @access  Private (Donor only)
router.post('/:id([0-9a-fA-F]{24})/respond', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    if (request.status !== 'requested') {
      return res.status(400).json({
        success: false,
        message: 'Can only respond to requested requests'
      });
    }

    // Get donor profile
    const donor = await Donor.findOne({ user: req.user._id });

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found. Please create your profile first.'
      });
    }

    // Check if donor already responded
    const existingResponse = request.responses.find(
      res => res.donorId.toString() === donor._id.toString()
    );

    if (existingResponse) {
      return res.status(400).json({
        success: false,
        message: 'You have already responded to this request'
      });
    }

    const { status, message } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide response status'
      });
    }

    // Add response
    request.responses.push({
      donorId: donor._id,
      status: status || 'Interested',
      message: message || '',
      respondedAt: Date.now()
    });

    await request.save();

    await request.populate([
      { path: 'user', select: 'name email phone' },
      { path: 'responses.donorId', select: 'name bloodGroup phone' }
    ]);

    res.json({
      success: true,
      message: 'Response submitted successfully',
      request
    });
  } catch (error) {
    console.error('Respond to request error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error responding to request'
    });
  }
});

// @route   PUT /api/requests/:id/accept
// @desc    Donor accepts a pending blood request
// @access  Private (Donor only)
router.put('/:id([0-9a-fA-F]{24})/accept', protect, acceptRequest);

// @route   PUT /api/requests/:id/complete
// @desc    Receiver marks an accepted blood request as completed
// @access  Private (Receiver only)
router.put('/:id([0-9a-fA-F]{24})/complete', protect, completeRequest);

// @route   DELETE /api/requests/:id
// @desc    Delete blood request
// @access  Private (Only request creator)
router.delete('/:id([0-9a-fA-F]{24})', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (request.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'You can only delete your own requests' 
      });
    }

    await request.deleteOne();

    res.json({
      success: true,
      message: 'Blood request deleted successfully'
    });
  } catch (error) {
    console.error('Delete request error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error deleting blood request'
    });
  }
});

module.exports = router;
