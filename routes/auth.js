const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Donor = require('../models/Donor');
const Request = require('../models/Request');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { protect } = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

const normalizeEmail = (email = '') => email.trim().toLowerCase();

const getProviders = (user) => {
  const providers = new Set(Array.isArray(user.providers) ? user.providers : []);

  if (user.password) {
    providers.add('local');
  }

  if (user.googleId) {
    providers.add('google');
  }

  return Array.from(providers);
};

const hasProvider = (user, provider) => getProviders(user).includes(provider);

const ensureProvider = (user, provider) => {
  if (typeof user.addProvider === 'function') {
    user.addProvider(provider);
    return;
  }

  const providers = new Set(user.providers || []);
  providers.add(provider);
  user.providers = Array.from(providers);
};

const serializeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  providers: getProviders(user),
  authProvider: user.authProvider,
  provider: user.authProvider,
  googleId: user.googleId || null,
  profilePhoto: user.profilePhoto || null,
  createdAt: user.createdAt
});

const getFirstName = (fullName = '') => fullName.trim().split(/\s+/)[0]?.toLowerCase() || '';

const normalizeProfilePhoto = (value) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch (error) {
    return null;
  }
};

const formatExistingAccountMessage = (user) => {
  const accountRole = user?.role || 'user';
  return `Account already exists as ${accountRole}. Please login.`;
};

const sendSignupAccountExistsResponse = (res) => {
  return res.status(409).json({
    success: false,
    code: 'ACCOUNT_EXISTS',
    message: 'Account already exists. Please log in.'
  });
};

const validateAndCreateUser = async ({ name, email, password, phone, role, profilePhoto }, res) => {
  if (!name || !email || !password || !phone || !role) {
    return res.status(400).json({
      success: false,
      message: 'Please provide all required fields: name, email, password, phone, role'
    });
  }

  if (!['donor', 'receiver', 'admin'].includes(role)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid role. Must be donor, receiver, or admin'
    });
  }

  const emailRegex = /^\S+@\S+\.\S+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email address'
    });
  }

  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid 10-digit phone number'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });
  }

  const normalizedEmail = normalizeEmail(email);

  // Signup must fail cleanly when the email is already registered.
  // Do not create a user, issue a token, or authenticate the request.
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return sendSignupAccountExistsResponse(res);
  }

  const phoneExistsForRole = await User.findOne({ phone, role });
  if (phoneExistsForRole) {
    return res.status(400).json({
      success: false,
      message: `A ${role} account already exists with this mobile number. Please login instead.`
    });
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    phone,
    role,
    providers: ['local'],
    profilePhoto: normalizeProfilePhoto(profilePhoto)
  });

  const token = generateToken(user._id);

  return res.status(201).json({
    success: true,
    message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully`,
    token,
    user: serializeUser(user)
  });
};

const loginUserByRole = async ({ email, password, role }, res) => {
  if (!email || !password || !role) {
    return res.status(400).json({
      success: false,
      message: 'Please provide email, password, and role'
    });
  }

  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found. Please sign up first.'
    });
  }

  if (user.role !== role) {
    return res.status(401).json({
      success: false,
      message: `This account is registered as a ${user.role}. Please use the correct login.`
    });
  }

  if (!user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Your account has been deactivated. Please contact support.'
    });
  }

  if (!hasProvider(user, 'local') || !user.password) {
    return res.status(400).json({
      success: false,
      message: 'Password not set. Use Google login.'
    });
  }

  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password.'
    });
  }

  const token = generateToken(user._id);

  return res.json({
    success: true,
    message: `${role.charAt(0).toUpperCase() + role.slice(1)} login successful`,
    token,
    user: serializeUser(user)
  });
};

const verifyGoogleCredential = async (credential) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('Google OAuth is not configured on the server');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();

  if (!payload?.email || !payload?.sub) {
    throw new Error('Google account payload is incomplete');
  }

  if (payload.email_verified === false) {
    throw new Error('Google email is not verified');
  }

  return payload;
};

router.get('/google-config', (req, res) => {
  res.json({
    success: true,
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

router.post('/signup/donor', async (req, res) => {
  try {
    return await validateAndCreateUser({ ...req.body, role: 'donor' }, res);
  } catch (error) {
    console.error('Donor signup error:', error);

    if (error.code === 11000 && error.keyPattern?.email) {
      return sendSignupAccountExistsResponse(res);
    }

    return res.status(500).json({
      success: false,
      message: 'Server error during donor signup',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/donor/signup', async (req, res) => {
  try {
    return await validateAndCreateUser({ ...req.body, role: 'donor' }, res);
  } catch (error) {
    console.error('Donor signup error:', error);

    if (error.code === 11000 && error.keyPattern?.email) {
      return sendSignupAccountExistsResponse(res);
    }

    return res.status(500).json({
      success: false,
      message: 'Server error during donor signup',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/signup/receiver', async (req, res) => {
  try {
    return await validateAndCreateUser({ ...req.body, role: 'receiver' }, res);
  } catch (error) {
    console.error('Receiver signup error:', error);

    if (error.code === 11000 && error.keyPattern?.email) {
      return sendSignupAccountExistsResponse(res);
    }

    return res.status(500).json({
      success: false,
      message: 'Server error during receiver signup',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/receiver/signup', async (req, res) => {
  try {
    return await validateAndCreateUser({ ...req.body, role: 'receiver' }, res);
  } catch (error) {
    console.error('Receiver signup error:', error);

    if (error.code === 11000 && error.keyPattern?.email) {
      return sendSignupAccountExistsResponse(res);
    }

    return res.status(500).json({
      success: false,
      message: 'Server error during receiver signup',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/login/donor', async (req, res) => {
  try {
    return await loginUserByRole({ ...req.body, role: 'donor' }, res);
  } catch (error) {
    console.error('Donor login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during donor login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/donor/login', async (req, res) => {
  try {
    return await loginUserByRole({ ...req.body, role: 'donor' }, res);
  } catch (error) {
    console.error('Donor login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during donor login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/login/receiver', async (req, res) => {
  try {
    return await loginUserByRole({ ...req.body, role: 'receiver' }, res);
  } catch (error) {
    console.error('Receiver login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during receiver login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/receiver/login', async (req, res) => {
  try {
    return await loginUserByRole({ ...req.body, role: 'receiver' }, res);
  } catch (error) {
    console.error('Receiver login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during receiver login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/signup
// @desc    Register new user (donor or receiver)
// @access  Public
router.post('/signup', async (req, res) => {
  try {
    return await validateAndCreateUser(req.body, res);
  } catch (error) {
    console.error('Signup error:', error);
    
    // Handle duplicate key error (MongoDB unique constraint)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const duplicateRole = req.body.role || 'user';
      if (field === 'email') {
        return sendSignupAccountExistsResponse(res);
      }

      return res.status(400).json({
        success: false,
        message: `A ${duplicateRole} account already exists with this mobile number. Please login instead.`
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Server error during signup',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
  try {
    return await loginUserByRole(req.body, res);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { credential, role, name, intent } = req.body;

    if (!credential || !role) {
      return res.status(400).json({
        success: false,
        message: 'Google credential and role are required'
      });
    }

    if (!['donor', 'receiver', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be donor, receiver, or admin'
      });
    }

    const googleProfile = await verifyGoogleCredential(credential);
    const normalizedEmail = normalizeEmail(googleProfile.email);
    const userByGoogleId = await User.findOne({ googleId: googleProfile.sub });
    const userByEmail = await User.findOne({ email: normalizedEmail });
    let user = userByGoogleId || userByEmail;

    if (intent === 'signup' && userByEmail) {
      return res.status(409).json({
        success: false,
        message: formatExistingAccountMessage(userByEmail)
      });
    }

    if (user) {
      // Never allow the same Google account or email to map to two users.
      if (userByGoogleId && userByEmail && String(userByGoogleId._id) !== String(userByEmail._id)) {
        return res.status(409).json({
          success: false,
          message: 'A conflicting account already exists for this email. Please contact support.'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Your account has been deactivated. Please contact support.'
        });
      }

      if (user.role !== role) {
        return res.status(401).json({
          success: false,
          message: `This account is registered as a ${user.role}. Please use the correct login.`
        });
      }

      let shouldSave = false;

      if (!user.googleId) {
        user.googleId = googleProfile.sub;
        shouldSave = true;
      }

      if (!hasProvider(user, 'google')) {
        ensureProvider(user, 'google');
        shouldSave = true;
      }

      if (!user.name && (name || googleProfile.name)) {
        user.name = name || googleProfile.name;
        shouldSave = true;
      }

      if (!user.profilePhoto && googleProfile.picture) {
        user.profilePhoto = googleProfile.picture;
        shouldSave = true;
      }

      if (shouldSave) {
        await user.save();
      }
    } else {
      user = await User.create({
        name: name || googleProfile.name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        role,
        providers: ['google'],
        googleId: googleProfile.sub,
        profilePhoto: googleProfile.picture || null
      });
    }

    const token = generateToken(user._id);

    return res.status(200).json({
      success: true,
      message: `${user.role.charAt(0).toUpperCase() + user.role.slice(1)} Google login successful`,
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    console.error('Google auth error:', error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists. Please login.'
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Google authentication failed'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    res.json({
      success: true,
      user: {
        ...serializeUser(user),
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching user data'
    });
  }
});

// @route   PUT /api/auth/update-profile
// @desc    Update user profile
// @access  Private
router.put('/update-profile', protect, async (req, res) => {
  try {
    const { name, phone, profilePhoto } = req.body;

    const fieldsToUpdate = {};
    if (name) fieldsToUpdate.name = name;
    if (phone) {
      // Validate phone format
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid 10-digit phone number'
        });
      }
      fieldsToUpdate.phone = phone;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'profilePhoto')) {
      fieldsToUpdate.profilePhoto = normalizeProfilePhoto(profilePhoto);
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      fieldsToUpdate,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        providers: getProviders(user),
        authProvider: user.authProvider,
        provider: user.authProvider,
        googleId: user.googleId || null,
        profilePhoto: user.profilePhoto || null
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating profile'
    });
  }
});

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Google-only users can add a password for the first time without a current password.
    const requiresCurrentPassword = hasProvider(user, 'local') && !!user.password;

    if (requiresCurrentPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Please provide current password and new password'
        });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
    }

    // Setting a password links local auth to a Google-first account.
    user.password = newPassword;
    ensureProvider(user, 'local');
    await user.save();

    res.json({
      success: true,
      message: requiresCurrentPassword
        ? 'Password changed successfully'
        : 'Password set successfully. You can now log in with email and password.'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error changing password'
    });
  }
});

// @route   DELETE /api/auth/delete-account
// @desc    Delete user account and all related data
// @access  Private
router.delete('/delete-account', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { password, confirmName } = req.body;
    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!confirmName || getFirstName(confirmName) !== getFirstName(user.name)) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect username.'
      });
    }

    if (hasProvider(user, 'local') && user.password) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your password to delete your account'
        });
      }

      const isPasswordMatch = await user.comparePassword(password);

      if (!isPasswordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Incorrect password. Account deletion cancelled.'
        });
      }
    }

    // Delete based on role
    if (userRole === 'donor') {
      // Delete donor profile
      await Donor.deleteMany({ user: userId });
      console.log(`Deleted donor profile for user: ${userId}`);
    } else if (userRole === 'receiver') {
      // Delete all blood requests created by receiver
      await Request.deleteMany({ user: userId });
      console.log(`Deleted blood requests for user: ${userId}`);
    }

    // Delete user account
    await user.deleteOne();

    res.json({
      success: true,
      message: 'Account and all related data deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error during account deletion',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/forgot-password (placeholder)
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user found with this email'
      });
    }

    // TODO: Implement password reset logic with email
    // For now, return a placeholder response

    res.json({
      success: true,
      message: 'Password reset functionality coming soon. Please contact support.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing password reset request'
    });
  }
});

module.exports = router;
