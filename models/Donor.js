const mongoose = require('mongoose');

const donorSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: [true, 'Please provide name']
  },
  phone: {
    type: String,
    required: [true, 'Please provide phone number'],
    match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit phone number']
  },
  bloodGroup: {
    type: String,
    required: [true, 'Please provide blood group'],
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
  },
  age: {
    type: Number,
    required: [true, 'Please provide age'],
    min: [18, 'Age must be at least 18'],
    max: [65, 'Age must be less than 65']
  },
  gender: {
    type: String,
    required: [true, 'Please provide gender'],
    enum: ['Male', 'Female', 'Other']
  },
  address: {
    street: {
      type: String
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    pincode: {
      type: String,
      required: true,
      match: [/^[0-9]{6}$/, 'Please provide a valid 6-digit pincode']
    },
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  lastDonationDate: {
    type: Date,
    default: null
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  donationCount: {
    type: Number,
    default: 0
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for efficient searching
donorSchema.index({ bloodGroup: 1, 'address.city': 1, isAvailable: 1 });
donorSchema.index({ user: 1 });

// Check if donor is eligible to donate (3 months gap)
donorSchema.methods.isEligibleToDonate = function() {
  if (!this.lastDonationDate) return true;
  
  const monthsGap = 3;
  const eligibleDate = new Date(this.lastDonationDate);
  eligibleDate.setMonth(eligibleDate.getMonth() + monthsGap);
  
  return Date.now() >= eligibleDate;
};

// Static method to calculate distance between two coordinates (Haversine formula)
donorSchema.statics.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
};

module.exports = mongoose.model('Donor', donorSchema);