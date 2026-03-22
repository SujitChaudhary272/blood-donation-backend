const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },
    password: {
      type: String,
      minlength: 6,
      select: false
    },
    phone: {
      type: String,
      match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit phone number']
    },
    role: {
      type: String,
      enum: ['donor', 'receiver', 'admin'],
      required: [true, 'Please specify user role']
    },
    providers: {
      type: [
        {
          type: String,
          enum: ['local', 'google']
        }
      ],
      default: ['local'],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one authentication provider is required'
      }
    },
    googleId: {
      type: String,
      default: null
    },
    profilePhoto: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Keep email unique across accounts so Google and local auth link to the same user.
userSchema.index({ email: 1 }, { unique: true });
userSchema.index(
  { phone: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone: { $type: 'string' }
    }
  }
);
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

userSchema.pre('validate', function normalizeProviders(next) {
  const normalizedProviders = Array.isArray(this.providers)
    ? [...new Set(this.providers.filter(Boolean))]
    : [];

  if (normalizedProviders.length === 0) {
    normalizedProviders.push(this.googleId ? 'google' : 'local');
  }

  if (this.password && !normalizedProviders.includes('local')) {
    normalizedProviders.push('local');
  }

  if (this.googleId && !normalizedProviders.includes('google')) {
    normalizedProviders.push('google');
  }

  this.providers = normalizedProviders;

  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }

  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.password || !this.isModified('password')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Alternative method name for compatibility
userSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.hasProvider = function hasProvider(provider) {
  return Array.isArray(this.providers) && this.providers.includes(provider);
};

userSchema.methods.addProvider = function addProvider(provider) {
  if (!['local', 'google'].includes(provider)) {
    return;
  }

  const providers = new Set(this.providers || []);
  providers.add(provider);
  this.providers = Array.from(providers);
};

userSchema.virtual('authProvider')
  .get(function authProviderGetter() {
    if (this.hasProvider('local') || this.password) {
      return 'local';
    }

    if (this.hasProvider('google') || this.googleId) {
      return 'google';
    }

    return null;
  })
  .set(function authProviderSetter(provider) {
    this.addProvider(provider);
  });

// Backward-compatible alias for clients that expect `provider`.
userSchema.virtual('provider').get(function providerAlias() {
  return this.authProvider;
});

module.exports = mongoose.model('User', userSchema);
