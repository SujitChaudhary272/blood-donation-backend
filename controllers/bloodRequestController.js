// controllers/bloodRequestController.js
const BloodRequest = require('../models/Request');
const Donor = require('../models/Donor');
const User = require('../models/User');
const { sendNotificationToNearbyDonors } = require('../services/notificationService');
const { generateCertificate } = require('../services/certificateService');

const normalizeEmail = (email = '') => email.trim().toLowerCase();

const findAndRelinkDonorProfile = async (user) => {
  let donor = await Donor.findOne({ user: user._id });

  if (donor || !user?.email) {
    return donor;
  }

  const normalizedEmail = normalizeEmail(user.email);
  const linkedUsers = await User.find({ email: normalizedEmail }).select('_id');

  if (linkedUsers.length === 0) {
    return null;
  }

  donor = await Donor.findOne({
    user: { $in: linkedUsers.map((linkedUser) => linkedUser._id) }
  });

  if (!donor || String(donor.user) === String(user._id)) {
    return donor;
  }

  donor.user = user._id;
  await donor.save();

  return donor;
};

exports.createRequest = async (req, res) => {
  try {
    if (req.user.role !== 'receiver') {
      return res.status(403).json({
        success: false,
        message: 'Only receivers can create donor requests'
      });
    }

    const { donorId } = req.body;

    if (!donorId) {
      return res.status(400).json({
        success: false,
        message: 'Donor ID is required'
      });
    }

    const donor = await Donor.findById(donorId).populate('user', 'name email phone');
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Selected donor not found'
      });
    }

    const existingRequest = await BloodRequest.findOne({
      receiver: req.user._id,
      donor: donor._id,
      status: { $in: ['requested', 'accepted'] }
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You have already sent an active request to this donor'
      });
    }

    const request = await BloodRequest.create({
      receiver: req.user._id,
      donor: donor._id,
      user: req.user._id,
      patientName: req.user.name || '',
      bloodGroup: donor.bloodGroup,
      unitsRequired: 1,
      hospitalName: 'BloodLife Portal',
      hospitalAddress: {
        street: 'N/A',
        city: 'N/A',
        state: 'N/A',
        pincode: '000000'
      },
      contactPerson: {
        name: req.user.name || '',
        phone: req.user.phone || '0000000000',
        email: req.user.email || ''
      },
      requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'requested'
    });

    await request.populate([
      { path: 'receiver', select: 'name email phone' },
      { path: 'donor', select: 'name bloodGroup phone address' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Blood request sent successfully',
      request
    });
  } catch (error) {
    console.error('Create donor request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create donor request'
    });
  }
};

exports.getDonorRequests = async (req, res) => {
  try {
    if (req.user.role !== 'donor') {
      return res.status(403).json({
        success: false,
        message: 'Only donors can view donor requests'
      });
    }

    const donor = await findAndRelinkDonorProfile(req.user);
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found'
      });
    }

    const requests = await BloodRequest.find({ donor: donor._id })
      .populate('receiver', 'name email phone')
      .populate('donor', 'name bloodGroup phone address user')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    console.error('Get donor requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch donor requests'
    });
  }
};

exports.getReceiverRequests = async (req, res) => {
  try {
    if (req.user.role !== 'receiver') {
      return res.status(403).json({
        success: false,
        message: 'Only receivers can view receiver requests'
      });
    }

    const requests = await BloodRequest.find({ receiver: req.user._id })
      .populate('receiver', 'name email phone')
      .populate('donor', 'name bloodGroup phone address user')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    console.error('Get receiver requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch receiver requests'
    });
  }
};

// Create a new blood request
exports.createBloodRequest = async (req, res) => {
  try {
    const {
      patientName,
      bloodGroup,
      unitsRequired,
      hospitalName,
      hospitalAddress,
      contactPerson,
      urgency,
      requiredBy,
      notes
    } = req.body;

    // Validate required fields
    if (!patientName || !bloodGroup || !unitsRequired || !hospitalName || !contactPerson || !requiredBy) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Validate hospital address
    if (!hospitalAddress || !hospitalAddress.street || !hospitalAddress.city || !hospitalAddress.state || !hospitalAddress.pincode) {
      return res.status(400).json({
        success: false,
        message: 'Please provide complete hospital address'
      });
    }

    // Validate contact person
    if (!contactPerson.name || !contactPerson.phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide contact person details'
      });
    }

    // Create blood request
    const bloodRequest = await BloodRequest.create({
      userId: req.user._id,
      patientName,
      bloodGroup,
      unitsRequired,
      hospitalName,
      hospitalAddress,
      contactPerson,
      urgency,
      requiredBy,
      notes
    });

    // Find and notify nearby donors with matching blood group
    if (hospitalAddress.coordinates && hospitalAddress.coordinates.lat && hospitalAddress.coordinates.lng) {
      try {
        await sendNotificationToNearbyDonors(bloodRequest);
      } catch (notificationError) {
        console.error('Notification error:', notificationError);
        // Continue even if notification fails
      }
    }

    res.status(201).json({
      success: true,
      message: 'Blood request created successfully',
      data: bloodRequest
    });
  } catch (error) {
    console.error('Create blood request error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create blood request'
    });
  }
};

// Get all blood requests (with filters)
exports.getAllBloodRequests = async (req, res) => {
  try {
    const { bloodGroup, city, state, urgency, status = 'Active' } = req.query;
    
    // Build query
    const query = { status };
    
    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (city) query['hospitalAddress.city'] = new RegExp(city, 'i');
    if (state) query['hospitalAddress.state'] = new RegExp(state, 'i');
    if (urgency) query.urgency = urgency;

    // Execute query with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const bloodRequests = await BloodRequest.find(query)
      .populate('userId', 'name email')
      .sort({ urgency: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await BloodRequest.countDocuments(query);

    res.status(200).json({
      success: true,
      count: bloodRequests.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: bloodRequests
    });
  } catch (error) {
    console.error('Get blood requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blood requests'
    });
  }
};

// Get user's own blood requests
exports.getMyBloodRequests = async (req, res) => {
  try {
    const bloodRequests = await BloodRequest.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('fulfilledBy', 'name phone bloodGroup');

    res.status(200).json({
      success: true,
      count: bloodRequests.length,
      data: bloodRequests
    });
  } catch (error) {
    console.error('Get my requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your requests'
    });
  }
};

// Get a specific blood request by ID
exports.getBloodRequestById = async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findById(req.params.id)
      .populate('userId', 'name email')
      .populate('fulfilledBy', 'name phone bloodGroup')
      .populate('responses.donorId', 'name phone bloodGroup');

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Increment view count
    bloodRequest.viewCount += 1;
    await bloodRequest.save();

    res.status(200).json({
      success: true,
      data: bloodRequest
    });
  } catch (error) {
    console.error('Get blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blood request'
    });
  }
};

// Update blood request
exports.updateBloodRequest = async (req, res) => {
  try {
    let bloodRequest = await BloodRequest.findById(req.params.id);

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (bloodRequest.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this request'
      });
    }

    // Don't allow updates to fulfilled or cancelled requests
    if (bloodRequest.status === 'Fulfilled' || bloodRequest.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot update ${bloodRequest.status.toLowerCase()} request`
      });
    }

    // Update fields
    const allowedUpdates = [
      'patientName', 'unitsRequired', 'hospitalName', 'hospitalAddress',
      'contactPerson', 'urgency', 'requiredBy', 'notes'
    ];

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        bloodRequest[field] = req.body[field];
      }
    });

    await bloodRequest.save();

    res.status(200).json({
      success: true,
      message: 'Blood request updated successfully',
      data: bloodRequest
    });
  } catch (error) {
    console.error('Update blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update blood request'
    });
  }
};

// Delete blood request
exports.deleteBloodRequest = async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findById(req.params.id);

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (bloodRequest.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this request'
      });
    }

    await bloodRequest.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Blood request deleted successfully'
    });
  } catch (error) {
    console.error('Delete blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete blood request'
    });
  }
};

// Cancel blood request
exports.cancelBloodRequest = async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findById(req.params.id);

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (bloodRequest.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this request'
      });
    }

    if (bloodRequest.status !== 'Active') {
      return res.status(400).json({
        success: false,
        message: 'Only active requests can be cancelled'
      });
    }

    bloodRequest.status = 'Cancelled';
    await bloodRequest.save();

    res.status(200).json({
      success: true,
      message: 'Blood request cancelled successfully',
      data: bloodRequest
    });
  } catch (error) {
    console.error('Cancel blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel blood request'
    });
  }
};

// Mark request as fulfilled
exports.fulfillBloodRequest = async (req, res) => {
  try {
    const { donorId } = req.body;
    const bloodRequest = await BloodRequest.findById(req.params.id);

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if user owns the request
    if (bloodRequest.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to fulfill this request'
      });
    }

    if (bloodRequest.status !== 'Active') {
      return res.status(400).json({
        success: false,
        message: 'Only active requests can be fulfilled'
      });
    }

    bloodRequest.status = 'Fulfilled';
    bloodRequest.fulfilledBy = donorId;
    bloodRequest.fulfilledAt = new Date();
    await bloodRequest.save();

    res.status(200).json({
      success: true,
      message: 'Blood request marked as fulfilled',
      data: bloodRequest
    });
  } catch (error) {
    console.error('Fulfill blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fulfill blood request'
    });
  }
};

// Get nearby blood requests for donors
exports.getNearbyBloodRequests = async (req, res) => {
  try {
    const { lat, lng, radius = 50 } = req.query; // radius in kilometers

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Please provide latitude and longitude'
      });
    }

    // Get donor's blood group
    const donor = await Donor.findOne({ userId: req.user._id });
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found'
      });
    }

    // Convert radius to radians (radius / earth radius in km)
    const radiusInRadians = radius / 6371;

    // Find nearby requests with matching blood group
    const bloodRequests = await BloodRequest.find({
      status: 'Active',
      bloodGroup: donor.bloodGroup,
      'hospitalAddress.coordinates.lat': { $exists: true },
      'hospitalAddress.coordinates.lng': { $exists: true }
    }).populate('userId', 'name email');

    // Calculate distance and filter
    const nearbyRequests = bloodRequests.filter(request => {
      const lat1 = parseFloat(lat);
      const lng1 = parseFloat(lng);
      const lat2 = request.hospitalAddress.coordinates.lat;
      const lng2 = request.hospitalAddress.coordinates.lng;

      const distance = calculateDistance(lat1, lng1, lat2, lng2);
      request.distance = distance; // Add distance to response
      return distance <= radius;
    });

    // Sort by distance and urgency
    nearbyRequests.sort((a, b) => {
      const urgencyOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
      if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      }
      return a.distance - b.distance;
    });

    res.status(200).json({
      success: true,
      count: nearbyRequests.length,
      data: nearbyRequests
    });
  } catch (error) {
    console.error('Get nearby requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nearby requests'
    });
  }
};

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Donor responds to blood request
exports.respondToBloodRequest = async (req, res) => {
  try {
    const { message, status } = req.body;
    const bloodRequest = await BloodRequest.findById(req.params.id);

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Get donor profile
    const donor = await Donor.findOne({ userId: req.user._id });
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found'
      });
    }

    // Add response
    bloodRequest.responses.push({
      donorId: donor._id,
      status: status || 'Pending',
      message
    });

    await bloodRequest.save();

    res.status(200).json({
      success: true,
      message: 'Response submitted successfully',
      data: bloodRequest
    });
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit response'
    });
  }
};

exports.acceptRequest = async (req, res) => {
  try {
    if (req.user.role !== 'donor') {
      return res.status(403).json({
        success: false,
        message: 'Only donors can accept blood requests'
      });
    }

    const donor = await findAndRelinkDonorProfile(req.user);
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found. Please complete donor registration first.'
      });
    }

    const bloodRequest = await BloodRequest.findById(req.params.id)
      .populate('receiver', 'name email phone')
      .populate('donor', 'name bloodGroup phone address');

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    if (!bloodRequest.donor || bloodRequest.donor._id.toString() !== donor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to accept this request'
      });
    }

    if (bloodRequest.status !== 'requested') {
      return res.status(400).json({
        success: false,
        message: 'Only requested blood requests can be accepted'
      });
    }

    bloodRequest.status = 'accepted';
    bloodRequest.acceptedDonor = donor._id;
    bloodRequest.fulfilledBy = donor._id;

    const existingResponse = bloodRequest.responses.find(
      (response) => response.donorId && response.donorId.toString() === donor._id.toString()
    );

    if (existingResponse) {
      existingResponse.status = 'Accepted';
      existingResponse.respondedAt = new Date();
    } else {
      bloodRequest.responses.push({
        donorId: donor._id,
        status: 'Accepted',
        message: 'Request accepted by donor',
        respondedAt: new Date()
      });
    }

    await bloodRequest.save();
    await bloodRequest.populate([
      { path: 'receiver', select: 'name email phone' },
      { path: 'donor', select: 'name bloodGroup phone address' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Blood request accepted successfully',
      request: bloodRequest
    });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept blood request'
    });
  }
};

exports.completeRequest = async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findById(req.params.id)
      .populate('receiver', 'name email phone')
      .populate('donor', 'name bloodGroup phone address');

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    if (
      req.user.role !== 'receiver' ||
      !bloodRequest.receiver ||
      bloodRequest.receiver._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Only the receiver who created this request can mark it as completed'
      });
    }

    if (bloodRequest.status !== 'accepted' || !bloodRequest.donor) {
      return res.status(400).json({
        success: false,
        message: 'Only accepted requests can be marked as completed'
      });
    }

    bloodRequest.status = 'completed';
    bloodRequest.completedAt = new Date();
    bloodRequest.acceptedDonor = bloodRequest.donor._id;
    bloodRequest.fulfilledBy = bloodRequest.donor._id;
    bloodRequest.fulfilledAt = bloodRequest.completedAt;

    await bloodRequest.save();

    const donor = await Donor.findById(bloodRequest.donor._id);
    if (donor) {
      donor.donationCount += 1;
      donor.lastDonationDate = bloodRequest.completedAt;
      await donor.save();
    }

    res.status(200).json({
      success: true,
      message: 'Blood request marked as completed',
      request: bloodRequest
    });
  } catch (error) {
    console.error('Complete request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete blood request'
    });
  }
};

exports.getCertificate = async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findById(req.params.requestId)
      .populate('receiver', 'name')
      .populate('donor', 'name')
      .populate('fulfilledBy', 'name')
      .populate('acceptedDonor', 'name')
      .populate('user', 'name');

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    const assignedDonor = bloodRequest.donor || bloodRequest.acceptedDonor || bloodRequest.fulfilledBy;
    const completedAt = bloodRequest.completedAt || bloodRequest.fulfilledAt;

    if (bloodRequest.status !== 'completed' || !assignedDonor || !completedAt) {
      return res.status(400).json({
        success: false,
        message: 'Certificate is available only after the donation is completed'
      });
    }

    const isReceiver =
      req.user.role === 'receiver' &&
      bloodRequest.receiver &&
      bloodRequest.receiver._id.toString() === req.user._id.toString();
    let isAcceptedDonor = false;

    if (req.user.role === 'donor') {
      const donor = await Donor.findOne({ user: req.user._id });
      isAcceptedDonor = donor ? donor._id.toString() === assignedDonor._id.toString() : false;
    }

    if (!isReceiver && !isAcceptedDonor) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to download this certificate'
      });
    }

    const receiver = bloodRequest.receiver || await User.findById(req.user._id).select('name');
    const pdfBuffer = await generateCertificate(
      assignedDonor.name,
      receiver?.name || bloodRequest.contactPerson?.name || 'Receiver',
      completedAt
    );

    if (!bloodRequest.certificateGeneratedAt) {
      bloodRequest.certificateGeneratedAt = new Date();
      await bloodRequest.save();
    }

    const safeName = assignedDonor.name.replace(/\s+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="blood-donation-certificate-${safeName}.pdf"`
    );

    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Get certificate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate certificate'
    });
  }
};
