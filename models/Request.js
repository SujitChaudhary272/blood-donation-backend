const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  donor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Donor',
    default: null
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  patientName: {
    type: String,
    default: '',
    trim: true
  },
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
  },
  unitsRequired: {
    type: Number,
    default: 1,
    min: [1, 'At least 1 unit is required'],
    max: [10, 'Maximum 10 units allowed']
  },
  hospitalName: {
    type: String,
    default: ''
  },
  hospitalAddress: {
    street: {
      type: String,
      default: ''
    },
    city: {
      type: String,
      default: ''
    },
    state: {
      type: String,
      default: ''
    },
    pincode: {
      type: String,
      default: '000000',
      match: [/^[0-9]{6}$/, 'Please provide a valid 6-digit pincode']
    },
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  contactPerson: {
    name: {
      type: String,
      default: ''
    },
    phone: {
      type: String,
      default: '0000000000',
      match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit phone number']
    },
    email: {
      type: String
    }
  },
  urgency: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  requiredBy: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  },
  isEmergency: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['requested', 'accepted', 'completed', 'Cancelled', 'Expired'],
    default: 'requested'
  },
  acceptedDonor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Donor',
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  certificateGeneratedAt: {
    type: Date,
    default: null
  },
  fulfilledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Donor',
    default: null
  },
  fulfilledAt: {
    type: Date,
    default: null
  },
  responses: [{
    donorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Donor'
    },
    status: {
      type: String,
      enum: ['Interested', 'Accepted', 'Declined', 'Pending'],
      default: 'Pending'
    },
    message: String,
    respondedAt: {
      type: Date,
      default: Date.now
    }
  }],
  viewCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient querying
requestSchema.index({ bloodGroup: 1, status: 1, urgency: 1 });
requestSchema.index({ user: 1, createdAt: -1 });
requestSchema.index({ 'hospitalAddress.city': 1, 'hospitalAddress.state': 1 });

// Virtual for checking if request is expired
requestSchema.virtual('isExpired').get(function() {
  return this.requiredBy < Date.now() && this.status === 'requested';
});

// Method to calculate priority score
requestSchema.methods.getPriorityScore = function() {
  const urgencyScores = {
    'Critical': 4,
    'High': 3,
    'Medium': 2,
    'Low': 1
  };
  
  const daysDiff = Math.ceil((this.requiredBy - Date.now()) / (1000 * 60 * 60 * 24));
  const timeScore = daysDiff <= 1 ? 3 : daysDiff <= 3 ? 2 : 1;
  
  return urgencyScores[this.urgency] + timeScore;
};

module.exports = mongoose.model('Request', requestSchema);
