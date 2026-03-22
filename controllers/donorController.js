const Donor = require('../models/Donor');

// @desc    Get all donors / Search donors
// @route   GET /api/donors
// @access  Public
exports.getDonors = async (req, res) => {
  try {
    const { bloodGroup, city, lat, lng, radius = 50 } = req.query;
    
    let query = { isAvailable: true };
    
    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (city) query['address.city'] = new RegExp(city.trim(), 'i');

    let donors = await Donor.find(query)
      .populate('userId', 'name email phone')
      .sort('-createdAt');

    // Filter by location if coordinates provided
    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const maxRadius = parseFloat(radius);

      donors = donors.filter(donor => {
        if (donor.address.coordinates && donor.address.coordinates.lat && donor.address.coordinates.lng) {
          const distance = Donor.calculateDistance(
            latitude,
            longitude,
            donor.address.coordinates.lat,
            donor.address.coordinates.lng
          );
          return distance <= maxRadius;
        }
        return false;
      }).map(donor => {
        const distance = Donor.calculateDistance(
          latitude,
          longitude,
          donor.address.coordinates.lat,
          donor.address.coordinates.lng
        );
        return {
          ...donor.toObject(),
          distance: distance.toFixed(2)
        };
      }).sort((a, b) => a.distance - b.distance);
    }

    res.status(200).json({
      success: true,
      count: donors.length,
      data: donors
    });
  } catch (error) {
    console.error('Get donors error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donors',
      error: error.message
    });
  }
};

// @desc    Get single donor
// @route   GET /api/donors/:id
// @access  Public
exports.getDonor = async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id)
      .populate('userId', 'name email phone');

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    res.status(200).json({
      success: true,
      data: donor
    });
  } catch (error) {
    console.error('Get donor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donor',
      error: error.message
    });
  }
};

// @desc    Register as donor
// @route   POST /api/donors
// @access  Private
exports.createDonor = async (req, res) => {
  try {
    const existingDonor = await Donor.findOne({ userId: req.user._id });
    
    if (existingDonor) {
      return res.status(400).json({
        success: false,
        message: 'You are already registered as a donor'
      });
    }

    const donorData = {
      userId: req.user._id,
      ...req.body
    };

    const donor = await Donor.create(donorData);
    
    await donor.populate('userId', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Donor registered successfully',
      data: donor
    });
  } catch (error) {
    console.error('Create donor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering donor',
      error: error.message
    });
  }
};

// @desc    Update donor
// @route   PUT /api/donors/:id
// @access  Private
exports.updateDonor = async (req, res) => {
  try {
    let donor = await Donor.findById(req.params.id);

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    if (donor.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this donor profile'
      });
    }

    donor = await Donor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('userId', 'name email phone');

    res.status(200).json({
      success: true,
      message: 'Donor updated successfully',
      data: donor
    });
  } catch (error) {
    console.error('Update donor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating donor',
      error: error.message
    });
  }
};

// @desc    Delete donor
// @route   DELETE /api/donors/:id
// @access  Private
exports.deleteDonor = async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id);

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    if (donor.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this donor profile'
      });
    }

    await donor.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Donor deleted successfully'
    });
  } catch (error) {
    console.error('Delete donor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting donor',
      error: error.message
    });
  }
};

// @desc    Get my donor profile
// @route   GET /api/donors/me/profile
// @access  Private
exports.getMyProfile = async (req, res) => {
  try {
    const donor = await Donor.findOne({ userId: req.user._id })
      .populate('userId', 'name email phone');

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor profile not found'
      });
    }

    res.status(200).json({
      success: true,
      data: donor
    });
  } catch (error) {
    console.error('Get my profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching donor profile',
      error: error.message
    });
  }
};