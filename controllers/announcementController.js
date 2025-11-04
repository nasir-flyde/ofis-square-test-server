import Announcement from '../models/announcementModel.js';
import Building from '../models/buildingModel.js';
import Member from '../models/memberModel.js';
import Client from '../models/clientModel.js';
import Notification from '../models/notificationModel.js';
import { logCRUDActivity } from '../utils/activityLogger.js';
import imagekit from '../utils/imageKit.js';

// Create Announcement
const createAnnouncement = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      description,
      details,
      location,
      externalLinks,
      category,
      priority,
      targetAudience,
      specificBuildings,
      specificMembers,
      specificClients,
      publishDate,
      expiryDate,
      status,
      isPinned,
      sendNotification,
      tags
    } = req.body;

    // Validate required fields
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    // Handle image uploads to ImageKit
    let thumbnailUrl = null;
    let mainImageUrl = null;
    let galleryUrls = [];

    if (req.files) {
      try {
        // Upload thumbnail if provided
        if (req.files.thumbnail && req.files.thumbnail[0]) {
          const thumbnailFile = req.files.thumbnail[0];
          const thumbnailUpload = await imagekit.upload({
            file: thumbnailFile.buffer.toString('base64'),
            fileName: `announcement-thumbnail-${Date.now()}-${thumbnailFile.originalname}`,
            folder: '/announcements/thumbnails'
          });
          thumbnailUrl = thumbnailUpload.url;
        }

        // Upload main image if provided
        if (req.files.mainImage && req.files.mainImage[0]) {
          const mainImageFile = req.files.mainImage[0];
          const mainImageUpload = await imagekit.upload({
            file: mainImageFile.buffer.toString('base64'),
            fileName: `announcement-main-${Date.now()}-${mainImageFile.originalname}`,
            folder: '/announcements/main'
          });
          mainImageUrl = mainImageUpload.url;
        }

        // Upload gallery images if provided
        if (req.files.gallery && req.files.gallery.length > 0) {
          for (const galleryFile of req.files.gallery) {
            const galleryUpload = await imagekit.upload({
              file: galleryFile.buffer.toString('base64'),
              fileName: `announcement-gallery-${Date.now()}-${galleryFile.originalname}`,
              folder: '/announcements/gallery'
            });
            galleryUrls.push(galleryUpload.url);
          }
        }
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload images',
          error: uploadError.message
        });
      }
    }

    // Validate building references
    if (location?.building) {
      const buildingExists = await Building.findById(location.building);
      if (!buildingExists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid building reference'
        });
      }
    }

    if (specificBuildings && specificBuildings.length > 0) {
      const buildings = await Building.find({ _id: { $in: specificBuildings } });
      if (buildings.length !== specificBuildings.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more building references are invalid'
        });
      }
    }

    // Create announcement
    const announcement = new Announcement({
      title,
      subtitle,
      description,
      details,
      location,
      externalLinks: externalLinks ? JSON.parse(externalLinks) : [],
      thumbnail: thumbnailUrl,
      mainImage: mainImageUrl,
      gallery: galleryUrls,
      category,
      priority,
      targetAudience,
      specificBuildings,
      specificMembers,
      specificClients,
      publishDate,
      expiryDate,
      status: status || 'draft',
      isPinned: isPinned || false,
      sendNotification: sendNotification || false,
      tags: tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [],
      author: req.user.userId
    });

    await announcement.save();

    // Send notifications if requested and announcement is published
    if (sendNotification && (status === 'published' || !status)) {
      await sendAnnouncementNotifications(announcement);
    }

    // Log activity
    await logCRUDActivity(
      'CREATE',
      'Announcement',
      announcement._id,
      req.user.userId,
      null,
      announcement.toObject()
    );

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      data: announcement
    });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create announcement',
      error: error.message
    });
  }
};

// Get All Announcements with filtering and pagination
const getAnnouncements = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      category,
      priority,
      targetAudience,
      building,
      isPinned,
      search,
      tags
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (category) query.category = category;
    if (priority) query.priority = priority;
    if (targetAudience) query.targetAudience = targetAudience;
    if (building) query['location.building'] = building;
    if (isPinned !== undefined) query.isPinned = isPinned === 'true';
    if (tags) query.tags = { $in: Array.isArray(tags) ? tags : [tags] };

    // Search in title, description, details
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;

    const announcements = await Announcement.find(query)
      .populate('author', 'name email')
      .populate('lastEditedBy', 'name email')
      .populate('location.building', 'name address')
      .populate('specificBuildings', 'name')
      .sort({ isPinned: -1, publishDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Announcement.countDocuments(query);

    res.status(200).json({
      success: true,
      data: announcements,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + announcements.length < total
      }
    });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements',
      error: error.message
    });
  }
};

// Get Single Announcement by ID
const getAnnouncementById = async (req, res) => {
  try {
    const { id } = req.params;

    const announcement = await Announcement.findById(id)
      .populate('author', 'name email')
      .populate('lastEditedBy', 'name email')
      .populate('location.building', 'name address')
      .populate('specificBuildings', 'name')
      .populate('specificMembers', 'name email')
      .populate('specificClients', 'companyName email');

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    // Increment view count and track viewer
    if (req.user && !announcement.viewedBy.includes(req.user.userId)) {
      announcement.views += 1;
      announcement.viewedBy.push(req.user.userId);
      await announcement.save();
    }

    res.status(200).json({
      success: true,
      data: announcement
    });
  } catch (error) {
    console.error('Get announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcement',
      error: error.message
    });
  }
};

// Update Announcement
const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    // Handle image uploads
    if (req.files) {
      try {
        if (req.files.thumbnail && req.files.thumbnail[0]) {
          const thumbnailFile = req.files.thumbnail[0];
          const thumbnailUpload = await imagekit.upload({
            file: thumbnailFile.buffer.toString('base64'),
            fileName: `announcement-thumbnail-${Date.now()}-${thumbnailFile.originalname}`,
            folder: '/announcements/thumbnails'
          });
          updateData.thumbnail = thumbnailUpload.url;
        }

        if (req.files.mainImage && req.files.mainImage[0]) {
          const mainImageFile = req.files.mainImage[0];
          const mainImageUpload = await imagekit.upload({
            file: mainImageFile.buffer.toString('base64'),
            fileName: `announcement-main-${Date.now()}-${mainImageFile.originalname}`,
            folder: '/announcements/main'
          });
          updateData.mainImage = mainImageUpload.url;
        }

        if (req.files.gallery && req.files.gallery.length > 0) {
          const galleryUrls = [];
          for (const galleryFile of req.files.gallery) {
            const galleryUpload = await imagekit.upload({
              file: galleryFile.buffer.toString('base64'),
              fileName: `announcement-gallery-${Date.now()}-${galleryFile.originalname}`,
              folder: '/announcements/gallery'
            });
            galleryUrls.push(galleryUpload.url);
          }
          updateData.gallery = [...(announcement.gallery || []), ...galleryUrls];
        }
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload images',
          error: uploadError.message
        });
      }
    }

    // Parse JSON fields if they're strings
    if (updateData.externalLinks && typeof updateData.externalLinks === 'string') {
      updateData.externalLinks = JSON.parse(updateData.externalLinks);
    }
    if (updateData.tags && typeof updateData.tags === 'string') {
      updateData.tags = JSON.parse(updateData.tags);
    }

    updateData.lastEditedBy = req.user.userId;
    updateData.updatedAt = new Date();

    const oldData = announcement.toObject();
    Object.assign(announcement, updateData);
    await announcement.save();

    // Send notifications if status changed to published and sendNotification is true
    if (updateData.status === 'published' && updateData.sendNotification && oldData.status !== 'published') {
      await sendAnnouncementNotifications(announcement);
    }

    // Log activity
    await logCRUDActivity(
      'UPDATE',
      'Announcement',
      announcement._id,
      req.user.userId,
      oldData,
      announcement.toObject()
    );

    res.status(200).json({
      success: true,
      message: 'Announcement updated successfully',
      data: announcement
    });
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update announcement',
      error: error.message
    });
  }
};

// Delete Announcement
const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    const oldData = announcement.toObject();
    await announcement.deleteOne();

    // Log activity
    await logCRUDActivity(
      'DELETE',
      'Announcement',
      id,
      req.user.userId,
      oldData,
      null
    );

    res.status(200).json({
      success: true,
      message: 'Announcement deleted successfully'
    });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete announcement',
      error: error.message
    });
  }
};

// Toggle Like on Announcement
const toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    const hasLiked = announcement.likedBy.includes(userId);

    if (hasLiked) {
      // Unlike
      announcement.likes -= 1;
      announcement.likedBy = announcement.likedBy.filter(id => id.toString() !== userId.toString());
    } else {
      // Like
      announcement.likes += 1;
      announcement.likedBy.push(userId);
    }

    await announcement.save();

    res.status(200).json({
      success: true,
      message: hasLiked ? 'Announcement unliked' : 'Announcement liked',
      data: {
        likes: announcement.likes,
        hasLiked: !hasLiked
      }
    });
  } catch (error) {
    console.error('Toggle like error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: error.message
    });
  }
};

// Get Active Announcements (for public display)
const getActiveAnnouncements = async (req, res) => {
  try {
    const { building, limit = 10 } = req.query;

    const query = {
      status: 'published',
      publishDate: { $lte: new Date() },
      $or: [
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        { expiryDate: { $gt: new Date() } }
      ]
    };

    if (building) {
      query.$or = [
        { 'location.building': building },
        { specificBuildings: building },
        { targetAudience: 'all' }
      ];
    }

    const announcements = await Announcement.find(query)
      .populate('author', 'name')
      .populate('location.building', 'name')
      .sort({ isPinned: -1, publishDate: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      data: announcements
    });
  } catch (error) {
    console.error('Get active announcements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active announcements',
      error: error.message
    });
  }
};

// Get Announcement Statistics
const getAnnouncementStats = async (req, res) => {
  try {
    const totalAnnouncements = await Announcement.countDocuments();
    const publishedAnnouncements = await Announcement.countDocuments({ status: 'published' });
    const draftAnnouncements = await Announcement.countDocuments({ status: 'draft' });
    const pinnedAnnouncements = await Announcement.countDocuments({ isPinned: true });

    const totalViews = await Announcement.aggregate([
      { $group: { _id: null, total: { $sum: '$views' } } }
    ]);

    const totalLikes = await Announcement.aggregate([
      { $group: { _id: null, total: { $sum: '$likes' } } }
    ]);

    const categoryStats = await Announcement.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalAnnouncements,
        published: publishedAnnouncements,
        draft: draftAnnouncements,
        pinned: pinnedAnnouncements,
        totalViews: totalViews[0]?.total || 0,
        totalLikes: totalLikes[0]?.total || 0,
        byCategory: categoryStats
      }
    });
  } catch (error) {
    console.error('Get announcement stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcement statistics',
      error: error.message
    });
  }
};

// Helper function to send notifications
const sendAnnouncementNotifications = async (announcement) => {
  try {
    let recipients = [];

    // Determine recipients based on target audience
    if (announcement.targetAudience === 'all') {
      // Send to all users (implement based on your user model)
      // This is a placeholder - adjust based on your needs
    } else if (announcement.targetAudience === 'members' && announcement.specificMembers?.length > 0) {
      recipients = announcement.specificMembers;
    } else if (announcement.targetAudience === 'clients' && announcement.specificClients?.length > 0) {
      recipients = announcement.specificClients;
    }

    // Create notifications for recipients
    if (recipients.length > 0) {
      const notifications = recipients.map(recipientId => ({
        userId: recipientId,
        title: announcement.title,
        message: announcement.description,
        type: 'announcement',
        relatedModel: 'Announcement',
        relatedId: announcement._id,
        priority: announcement.priority === 'urgent' ? 'high' : 'medium'
      }));

      await Notification.insertMany(notifications);
      
      announcement.notificationSentAt = new Date();
      await announcement.save();
    }
  } catch (error) {
    console.error('Send announcement notifications error:', error);
  }
};

export {
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  toggleLike,
  getActiveAnnouncements,
  getAnnouncementStats
};
