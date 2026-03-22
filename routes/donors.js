const express = require('express');
const router = express.Router();
const Donor = require('../models/Donor');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const normalizeEmail = (email = '') => email.trim().toLowerCase();

const findAndRelinkDonorProfile = async (user) => {
  let donor = await Donor.findOne({ user: user._id }).populate('user', 'name email phone');

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
  }).populate('user', 'name email phone');

  if (!donor || String(donor.user?._id || donor.user) === String(user._id)) {
    return donor;
  }

  donor.user = user._id;
  await donor.save();

  return Donor.findById(donor._id).populate('user', 'name email phone');
};

// @route   GET /api/donors
// @desc    Get all available donors (with optional filters)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { bloodGroup, city, state, isAvailable } = req.query;

    // Build query
    const query = {};
    
    if (bloodGroup) {
      query.bloodGroup = bloodGroup;
    }
    
    if (city) {
      query['address.city'] = new RegExp(city, 'i');
    }
    
    if (state) {
      query['address.state'] = new RegExp(state, 'i');
    }
    
    if (isAvailable !== undefined) {
      query.isAvailable = isAvailable === 'true';
    } else {
      // By default, show only available donors
      query.isAvailable = true;
    }

    const donors = await Donor.find(query)
      .populate('user', 'name email phone')
      .sort('-createdAt');

    res.json({
      success: true,
      count: donors.length,
      donors
    });
  } catch (error) {
    console.error('Get donors error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching donors' 
    });
  }
});

// @route   GET /api/donors/search
// @desc    Search donors by blood group and location
// @access  Private
router.get('/search', protect, async (req, res) => {
  try {
    const { bloodGroup, city, state, radius, lat, lng } = req.query;

    if (!bloodGroup) {
      return res.status(400).json({
        success: false,
        message: 'Blood group is required for search'
      });
    }

    const query = {
      bloodGroup,
      isAvailable: true
    };

    if (city) {
      query['address.city'] = new RegExp(city, 'i');
    }

    if (state) {
      query['address.state'] = new RegExp(state, 'i');
    }

    let donors = await Donor.find(query)
      .populate('user', 'name email phone')
      .sort('-donationCount');

    // If coordinates provided, calculate distance and sort by proximity
    if (lat && lng && donors.length > 0) {
      donors = donors.map(donor => {
        if (donor.address.coordinates && donor.address.coordinates.lat && donor.address.coordinates.lng) {
          const distance = Donor.calculateDistance(
            parseFloat(lat),
            parseFloat(lng),
            donor.address.coordinates.lat,
            donor.address.coordinates.lng
          );
          return {
            ...donor.toObject(),
            distance: distance.toFixed(2)
          };
        }
        return donor.toObject();
      });

      // Filter by radius if specified
      if (radius) {
        donors = donors.filter(donor => donor.distance && parseFloat(donor.distance) <= parseFloat(radius));
      }

      // Sort by distance
      donors.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
    }

    res.json({
      success: true,
      count: donors.length,
      donors
    });
  } catch (error) {
    console.error('Search donors error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error searching donors'
    });
  }
});

// @route   GET /api/donors/profile
// @desc    Get logged-in donor's profile
// @access  Private (Donor only)
router.get('/profile', protect, authorize('donor'), async (req, res) => {
  try {
    const donor = await findAndRelinkDonorProfile(req.user);

    if (!donor) {
      return res.status(404).json({ 
        success: false,
        message: 'Donor profile not found. Please create your profile first.' 
      });
    }

    res.json({
      success: true,
      donor
    });
  } catch (error) {
    console.error('Get donor profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching donor profile' 
    });
  }
});

// @route   GET /api/donors/:id
// @desc    Get single donor by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id)
      .populate('user', 'name email phone');

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    res.json({
      success: true,
      donor
    });
  } catch (error) {
    console.error('Get donor error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid donor ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error fetching donor'
    });
  }
});

// @route   POST /api/donors
// @desc    Register as donor (create donor profile)
// @access  Private (Donor only)
router.post('/', protect, authorize('donor'), async (req, res) => {
  try {
    // Check if donor profile already exists
    const existingDonor = await findAndRelinkDonorProfile(req.user);
    if (existingDonor) {
      return res.status(400).json({ 
        success: false,
        message: 'Donor profile already exists. Use PUT to update.' 
      });
    }

    // Required fields validation
    const { name, phone, bloodGroup, age, gender, address } = req.body;

    if (!name || !phone || !bloodGroup || !age || !gender || !address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, phone, bloodGroup, age, gender, address'
      });
    }

    if (!address.city || !address.state || !address.pincode) {
      return res.status(400).json({
        success: false,
        message: 'Please provide complete address (city, state, pincode)'
      });
    }

    // Create donor profile
    const donorData = {
      ...req.body,
      user: req.user._id
    };

    const donor = await Donor.create(donorData);

    // Populate user data
    await donor.populate('user', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Donor profile created successfully',
      donor
    });
  } catch (error) {
    console.error('Create donor error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Donor profile already exists for this user'
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
      message: 'Server error creating donor profile' 
    });
  }
});

// @route   PUT /api/donors/profile
// @desc    Update logged-in donor's profile
// @access  Private (Donor only)
router.put('/profile', protect, authorize('donor'), async (req, res) => {
  try {
    let donor = await findAndRelinkDonorProfile(req.user);

    if (!donor) {
      return res.status(404).json({ 
        success: false,
        message: 'Donor profile not found. Please create your profile first.' 
      });
    }

    // Fields that can be updated
    const allowedUpdates = [
      'name', 'phone', 'bloodGroup', 'age', 'gender', 
      'address', 'lastDonationDate', 'isAvailable'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    donor = await Donor.findOneAndUpdate(
      { user: req.user._id },
      updates,
      { new: true, runValidators: true }
    ).populate('user', 'name email phone');

    res.json({
      success: true,
      message: 'Donor profile updated successfully',
      donor
    });
  } catch (error) {
    console.error('Update donor error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Server error updating donor profile' 
    });
  }
});

// @route   PUT /api/donors/:id
// @desc    Update donor by ID (for admin or donor owner)
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    let donor = await Donor.findById(req.params.id);

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    // Check if user is the donor owner or admin
    if (donor.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this donor profile'
      });
    }

    donor = await Donor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('user', 'name email phone');

    res.json({
      success: true,
      message: 'Donor profile updated successfully',
      donor
    });
  } catch (error) {
    console.error('Update donor by ID error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid donor ID'
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
      message: 'Server error updating donor'
    });
  }
});

// @route   DELETE /api/donors/profile
// @desc    Delete logged-in donor's profile
// @access  Private (Donor only)
router.delete('/profile', protect, authorize('donor'), async (req, res) => {
  try {
    const donor = await findAndRelinkDonorProfile(req.user);

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found'
      });
    }

    await donor.deleteOne();

    res.json({
      success: true,
      message: 'Donor profile deleted successfully'
    });
  } catch (error) {
    console.error('Delete donor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting donor profile'
    });
  }
});

// @route   DELETE /api/donors/:id
// @desc    Delete donor by ID (admin only)
// @access  Private (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id);

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    await donor.deleteOne();

    res.json({
      success: true,
      message: 'Donor deleted successfully'
    });
  } catch (error) {
    console.error('Delete donor error:', error);

    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid donor ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error deleting donor'
    });
  }
});

module.exports = router;
