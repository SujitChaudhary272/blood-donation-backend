// backend/services/notificationService.js

/**
 * Dummy notification service
 * (No nodemailer, no external dependencies)
 */

const sendNotification = async ({ userId, message, type }) => {
  console.log('🔔 Notification triggered');
  console.log('User ID:', userId);
  console.log('Type:', type);
  console.log('Message:', message);
  return true;
};

module.exports = {
  sendNotification,
  sendNotificationToNearbyDonors: async (bloodRequest) => {
    console.log('Nearby donor notification requested for blood request:', bloodRequest?._id);
    return true;
  }
};
