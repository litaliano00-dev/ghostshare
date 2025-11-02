const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.'
});

app.use(limiter);
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Enhanced file upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  // Check file type
  const allowedTypes = {
    'image/jpeg': true,
    'image/jpg': true,
    'image/png': true,
    'image/gif': true,
    'video/mp4': true,
    'video/avi': true,
    'video/mov': true,
    'application/pdf': true,
    'text/plain': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true
  };

  if (allowedTypes[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for files
  },
  fileFilter: fileFilter
});

// Data persistence - Enhanced with backup system
const dataDir = './data';
const backupDir = './data/backups';

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

function loadData() {
  const data = {
    users: new Map(),
    friends: new Map(),
    groups: new Map(),
    chats: new Map(),
    messages: new Map(),
    pendingRequests: new Map()
  };

  try {
    const dataFiles = [
      { file: 'users.json', map: data.users },
      { file: 'friends.json', map: data.friends },
      { file: 'chats.json', map: data.chats },
      { file: 'messages.json', map: data.messages },
      { file: 'pendingRequests.json', map: data.pendingRequests },
      { file: 'groups.json', map: data.groups }
    ];

    for (const { file, map } of dataFiles) {
      const filePath = `${dataDir}/${file}`;
      if (fs.existsSync(filePath)) {
        try {
          const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          fileData.forEach(([key, value]) => map.set(key, value));
          console.log(`Loaded ${file} successfully`);
        } catch (parseError) {
          console.error(`Error parsing ${file}:`, parseError);
          // Try to load from backup
          const backupPath = `${backupDir}/${file}`;
          if (fs.existsSync(backupPath)) {
            try {
              const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
              backupData.forEach(([key, value]) => map.set(key, value));
              console.log(`Loaded ${file} from backup successfully`);
            } catch (backupError) {
              console.error(`Error loading backup ${file}:`, backupError);
            }
          }
        }
      }
    }

    console.log('Data loaded successfully from files');
  } catch (error) {
    console.log('No existing data found or error loading data, starting fresh');
  }

  return data;
}

function createBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFiles = ['users.json', 'friends.json', 'chats.json', 'messages.json', 'pendingRequests.json', 'groups.json'];

    backupFiles.forEach(file => {
      const sourcePath = `${dataDir}/${file}`;
      const backupPath = `${backupDir}/${timestamp}-${file}`;

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, backupPath);
      }
    });

    // Clean up old backups (keep only last 10)
    const files = fs.readdirSync(backupDir);
    const backupFilesList = files.filter(f => f.endsWith('.json'));
    if (backupFilesList.length > 10) {
      backupFilesList.sort().slice(0, backupFilesList.length - 10).forEach(file => {
        fs.unlinkSync(`${backupDir}/${file}`);
      });
    }
  } catch (error) {
    console.error('Error creating backup:', error);
  }
}

function saveData() {
  try {
    const dataFiles = [
      { file: 'users.json', data: users },
      { file: 'friends.json', data: friends },
      { file: 'chats.json', data: chats },
      { file: 'messages.json', data: messages },
      { file: 'pendingRequests.json', data: pendingRequests },
      { file: 'groups.json', data: groups }
    ];

    // Create backup before saving
    createBackup();

    for (const { file, data } of dataFiles) {
      const filePath = `${dataDir}/${file}`;
      const tempPath = `${dataDir}/temp-${file}`;

      // Write to temporary file first
      fs.writeFileSync(tempPath, JSON.stringify(Array.from(data.entries())));
      // Then rename to actual file (atomic operation)
      fs.renameSync(tempPath, filePath);
    }

    console.log('Data saved successfully');
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Load initial data
const data = loadData();
const users = data.users;
const friends = data.friends;
const groups = data.groups;
const chats = data.chats;
const messages = data.messages;
const pendingRequests = data.pendingRequests;
const onlineUsers = new Map();

// Auto-save data every 30 seconds
setInterval(saveData, 30000);

// Save data on graceful shutdown
process.on('SIGINT', () => {
  console.log('Saving data before shutdown...');
  saveData();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Saving data before shutdown...');
  saveData();
  process.exit(0);
});

// helper functions
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getUserByUsername(username) {
  return users.get(username);
}

function saveUser(user) {
  users.set(user.username, user);
}

// Input validation
function validateUsername(username) {
  if (typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 20) return false;
  return /^[a-zA-Z0-9_]+$/.test(username);
}

function validatePassword(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 8;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '');
}

// user registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({ success: false, message: 'username and password required' });
    }

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'username must be 3-20 characters and contain only letters, numbers, and underscores' });
    }

    if (!validatePassword(password)) {
      return res.json({ success: false, message: 'password needs to be at least 8 characters' });
    }

    if (users.has(username)) {
      return res.json({ success: false, message: 'username not available, try another one' });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // create user
    const user = {
      id: generateId(),
      username: sanitizeInput(username),
      password: hashedPassword,
      avatar: null,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    saveUser(user);

    // setup user data
    friends.set(username, []);
    chats.set(username, []);
    pendingRequests.set(username, []);

    // Save data after registration
    saveData();

    res.json({
      success: true,
      message: 'account created!',
      user: { username: user.username, id: user.id }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.json({ success: false, message: 'registration failed' });
  }
});

// user login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({ success: false, message: 'username and password required' });
    }

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.json({ success: false, message: 'user not found' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.json({ success: false, message: 'wrong password' });
    }

    // Update last login
    user.lastLogin = new Date().toISOString();
    saveUser(user);

    // return user data (no password)
    const userData = { ...user };
    delete userData.password;

    res.json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, message: 'login failed' });
  }
});

// Enhanced friend requests with optional message
app.post('/api/friends/request', (req, res) => {
  try {
    const { username, friendUsername, message } = req.body;

    if (!username || !friendUsername) {
      return res.json({ success: false, message: 'username and friend username required' });
    }

    if (!validateUsername(username) || !validateUsername(friendUsername)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const user = getUserByUsername(username);
    const friend = getUserByUsername(friendUsername);

    if (!user || !friend) {
      return res.json({ success: false, message: 'user not found' });
    }

    if (username === friendUsername) {
      return res.json({ success: false, message: 'cant add yourself as friend' });
    }

    // check if already friends
    const userFriends = friends.get(username) || [];
    if (userFriends.find(f => f.username === friendUsername)) {
      return res.json({ success: false, message: 'already friends with this user' });
    }

    // check if request already exists
    const friendPendingRequests = pendingRequests.get(friendUsername) || [];
    if (friendPendingRequests.find(req => req.fromUser === username)) {
      return res.json({ success: false, message: 'friend request already sent' });
    }

    // create friend request
    const requestId = generateId();
    const request = {
      id: requestId,
      fromUser: username,
      toUser: friendUsername,
      type: 'friend',
      status: 'pending',
      message: message ? sanitizeInput(message.substring(0, 200)) : null,
      createdAt: new Date().toISOString()
    };

    // add to pending requests
    friendPendingRequests.push(request);
    pendingRequests.set(friendUsername, friendPendingRequests);

    // Save data after sending request
    saveData();

    // notify friend if online
    const friendSocket = onlineUsers.get(friendUsername);
    if (friendSocket) {
      io.to(friendSocket).emit('friend_request', {
        from: username,
        message: message ? `${username} sent you a friend request: "${message}"` : `${username} sent you a friend request`
      });
    }

    res.json({ success: true, message: 'friend request sent' });
  } catch (error) {
    console.error('Friend request error:', error);
    res.json({ success: false, message: 'failed to send friend request' });
  }
});

// Remove friend endpoint
app.post('/api/friends/remove', (req, res) => {
  try {
    const { username, friendUsername } = req.body;

    if (!username || !friendUsername) {
      return res.json({ success: false, message: 'username and friend username required' });
    }

    if (!validateUsername(username) || !validateUsername(friendUsername)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    // Remove from both users' friend lists
    const userFriends = friends.get(username) || [];
    const friendFriends = friends.get(friendUsername) || [];

    const updatedUserFriends = userFriends.filter(f => f.username !== friendUsername);
    const updatedFriendFriends = friendFriends.filter(f => f.username !== username);

    friends.set(username, updatedUserFriends);
    friends.set(friendUsername, updatedFriendFriends);

    // Save data
    saveData();

    // Notify both users if online
    const userSocket = onlineUsers.get(username);
    const friendSocket = onlineUsers.get(friendUsername);

    if (userSocket) {
      io.to(userSocket).emit('friend_removed', { friendUsername });
    }
    if (friendSocket) {
      io.to(friendSocket).emit('friend_removed', { friendUsername: username });
    }

    res.json({ success: true, message: 'friend removed successfully' });
  } catch (error) {
    console.error('Remove friend error:', error);
    res.json({ success: false, message: 'failed to remove friend' });
  }
});

// get friends list
app.get('/api/friends/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const userFriends = friends.get(username) || [];

    // update online status and add additional info
    const updatedFriends = userFriends.map(friend => ({
      ...friend,
      online: onlineUsers.has(friend.username),
      avatar: getUserByUsername(friend.username)?.avatar || null,
      lastSeen: getUserByUsername(friend.username)?.lastLogin || null
    }));

    res.json({ success: true, friends: updatedFriends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.json({ success: false, message: 'failed to load friends' });
  }
});

// Enhanced Group Creation Endpoint
app.post('/api/groups/create', (req, res) => {
  try {
    const { name, description, creator, members } = req.body;

    if (!name || !creator || !members || !Array.isArray(members)) {
      return res.json({ success: false, message: 'Group name, creator, and members are required' });
    }

    if (name.length < 2 || name.length > 30) {
      return res.json({ success: false, message: 'Group name must be 2-30 characters' });
    }

    if (!validateUsername(creator)) {
      return res.json({ success: false, message: 'Invalid creator username' });
    }

    // Validate all member usernames
    for (const member of members) {
      if (!validateUsername(member)) {
        return res.json({ success: false, message: `Invalid member username: ${member}` });
      }
      if (!users.has(member)) {
        return res.json({ success: false, message: `User not found: ${member}` });
      }
    }

    // Create group
    const groupId = generateId();
    const group = {
      id: groupId,
      name: sanitizeInput(name),
      description: description ? sanitizeInput(description.substring(0, 200)) : null,
      creator: creator,
      members: [...new Set([creator, ...members])], // Remove duplicates, ensure creator is included
      createdAt: new Date().toISOString(),
      avatar: null,
      lastActivity: new Date().toISOString()
    };

    // Save group
    groups.set(groupId, group);

    // Create group chat for all members
    const allMembers = [...new Set([creator, ...members])];
    allMembers.forEach(member => {
      const userChats = chats.get(member) || [];
      
      const groupChat = {
        id: groupId,
        withUser: group.name,
        avatar: null,
        lastMessage: `Group "${group.name}" created by ${creator}`,
        lastActivity: new Date().toISOString(),
        pinned: false,
        blocked: false,
        encrypted: false,
        isGroup: true,
        groupId: groupId
      };

      // Remove any existing group chat for this user
      const filteredChats = userChats.filter(chat => chat.id !== groupId);
      filteredChats.push(groupChat);
      chats.set(member, filteredChats);
    });

    // Initialize group messages
    const welcomeMessage = {
      id: generateId(),
      chatId: groupId,
      sender: 'system',
      text: `Group "${group.name}" was created by ${creator}. Members: ${group.members.join(', ')}`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };

    messages.set(groupId, [welcomeMessage]);

    // Save data
    saveData();

    // Notify all members
    group.members.forEach(member => {
      const memberSocket = onlineUsers.get(member);
      if (memberSocket) {
        io.to(memberSocket).emit('group_created', {
          groupId: groupId,
          groupName: group.name,
          creator: creator
        });
      }
    });

    res.json({
      success: true,
      message: 'Group created successfully',
      groupId: groupId
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.json({ success: false, message: 'Failed to create group' });
  }
});

// Get User's Groups Endpoint
app.get('/api/groups/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'Invalid username format' });
    }

    // Get all groups where user is a member
    const userGroups = [];
    for (const [groupId, group] of groups.entries()) {
      if (group.members.includes(username)) {
        userGroups.push({
          id: group.id,
          name: group.name,
          description: group.description,
          creator: group.creator,
          members: group.members,
          memberCount: group.members.length,
          createdAt: group.createdAt,
          lastActivity: group.lastActivity
        });
      }
    }

    res.json({ success: true, groups: userGroups });
  } catch (error) {
    console.error('Get groups error:', error);
    res.json({ success: false, message: 'Failed to load groups' });
  }
});

// Leave Group Endpoint
app.post('/api/groups/leave', (req, res) => {
  try {
    const { groupId, username } = req.body;

    if (!groupId || !username) {
      return res.json({ success: false, message: 'Group ID and username are required' });
    }

    const group = groups.get(groupId);
    if (!group) {
      return res.json({ success: false, message: 'Group not found' });
    }

    if (!group.members.includes(username)) {
      return res.json({ success: false, message: 'You are not a member of this group' });
    }

    if (group.creator === username) {
      return res.json({ success: false, message: 'Group creator cannot leave the group. Please delete the group instead.' });
    }

    // Remove user from group members
    group.members = group.members.filter(member => member !== username);
    groups.set(groupId, group);

    // Remove group chat from user's chats
    const userChats = chats.get(username) || [];
    const updatedChats = userChats.filter(chat => chat.id !== groupId);
    chats.set(username, updatedChats);

    // Add system message
    const groupMessages = messages.get(groupId) || [];
    const leaveMessage = {
      id: generateId(),
      chatId: groupId,
      sender: 'system',
      text: `${username} left the group`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    groupMessages.push(leaveMessage);
    messages.set(groupId, groupMessages);

    // Update group last activity
    group.lastActivity = new Date().toISOString();
    groups.set(groupId, group);

    // Save data
    saveData();

    // Notify remaining group members
    group.members.forEach(member => {
      const memberSocket = onlineUsers.get(member);
      if (memberSocket) {
        io.to(memberSocket).emit('group_member_left', {
          groupId: groupId,
          groupName: group.name,
          username: username
        });
      }
    });

    res.json({ success: true, message: 'Successfully left the group' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.json({ success: false, message: 'Failed to leave group' });
  }
});

// Delete Group Endpoint
app.post('/api/groups/delete', (req, res) => {
  try {
    const { groupId, username } = req.body;

    if (!groupId || !username) {
      return res.json({ success: false, message: 'Group ID and username are required' });
    }

    const group = groups.get(groupId);
    if (!group) {
      return res.json({ success: false, message: 'Group not found' });
    }

    if (group.creator !== username) {
      return res.json({ success: false, message: 'Only the group creator can delete the group' });
    }

    // Remove group from all members' chats
    group.members.forEach(member => {
      const userChats = chats.get(member) || [];
      const updatedChats = userChats.filter(chat => chat.id !== groupId);
      chats.set(member, updatedChats);
    });

    // Delete group and messages
    groups.delete(groupId);
    messages.delete(groupId);

    // Save data
    saveData();

    // Notify all former members
    group.members.forEach(member => {
      const memberSocket = onlineUsers.get(member);
      if (memberSocket) {
        io.to(memberSocket).emit('group_deleted', {
          groupId: groupId,
          groupName: group.name
        });
      }
    });

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.json({ success: false, message: 'Failed to delete group' });
  }
});

// Send Group Message Endpoint
app.post('/api/chats/group-message', (req, res) => {
  try {
    const { groupId, sender, text } = req.body;

    if (!groupId || !sender || !text) {
      return res.json({ success: false, message: 'Group ID, sender, and text are required' });
    }

    if (!validateUsername(sender)) {
      return res.json({ success: false, message: 'Invalid sender format' });
    }

    const group = groups.get(groupId);
    if (!group) {
      return res.json({ success: false, message: 'Group not found' });
    }

    if (!group.members.includes(sender)) {
      return res.json({ success: false, message: 'You are not a member of this group' });
    }

    const groupMessages = messages.get(groupId) || [];
    const message = {
      id: generateId(),
      chatId: groupId,
      sender: sender,
      text: sanitizeInput(text),
      timestamp: new Date().toISOString(),
      type: 'group'
    };

    groupMessages.push(message);
    messages.set(groupId, groupMessages);

    // Update last message in all members' chats
    group.members.forEach(member => {
      const userChats = chats.get(member) || [];
      const chatIndex = userChats.findIndex(chat => chat.id === groupId);
      if (chatIndex !== -1) {
        userChats[chatIndex].lastMessage = text.length > 50 ? text.substring(0, 50) + '...' : text;
        userChats[chatIndex].lastActivity = new Date().toISOString();
        chats.set(member, userChats);
      }
    });

    // Update group last activity
    group.lastActivity = new Date().toISOString();
    groups.set(groupId, group);

    // Save data
    saveData();

    // Notify all group members
    const messageData = {
      ...message,
      groupId: groupId,
      groupName: group.name
    };

    group.members.forEach(member => {
      const memberSocket = onlineUsers.get(member);
      if (memberSocket) {
        io.to(memberSocket).emit('group_message', messageData);
      }
    });

    res.json({ success: true, message: 'Group message sent' });
  } catch (error) {
    console.error('Send group message error:', error);
    res.json({ success: false, message: 'Failed to send group message' });
  }
});

// Get Group Messages Endpoint
app.get('/api/groups/:groupId/messages', (req, res) => {
  try {
    const { groupId } = req.params;
    const groupMessages = messages.get(groupId) || [];

    res.json({ success: true, messages: groupMessages });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.json({ success: false, message: 'Failed to load group messages' });
  }
});

// Enhanced start new chat - Always create chat immediately
app.post('/api/chats/start', (req, res) => {
  try {
    const { fromUser, toUser } = req.body;

    if (!fromUser || !toUser) {
      return res.json({ success: false, message: 'both users required' });
    }

    if (!validateUsername(fromUser) || !validateUsername(toUser)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const user = getUserByUsername(fromUser);
    const targetUser = getUserByUsername(toUser);

    if (!user || !targetUser) {
      return res.json({ success: false, message: 'user not found' });
    }

    if (fromUser === toUser) {
      return res.json({ success: false, message: 'cant chat with yourself' });
    }

    // check if chat already exists
    const userChats = chats.get(fromUser) || [];
    const existingChat = userChats.find(chat => chat.withUser === toUser && !chat.isGroup);

    if (existingChat) {
      return res.json({
        success: true,
        chatExists: true,
        chatId: existingChat.id
      });
    }

    // create new chat immediately (no friend requirement)
    const chatId = generateId();

    // add chat to both users
    const fromUserChats = chats.get(fromUser) || [];
    const toUserChats = chats.get(toUser) || [];

    const newChat = {
      id: chatId,
      withUser: toUser,
      avatar: targetUser.avatar,
      lastMessage: null,
      lastActivity: new Date().toISOString(),
      pinned: false,
      blocked: false,
      encrypted: true,
      isGroup: false
    };

    const targetChat = {
      id: chatId,
      withUser: fromUser,
      avatar: user.avatar,
      lastMessage: null,
      lastActivity: new Date().toISOString(),
      pinned: false,
      blocked: false,
      encrypted: true,
      isGroup: false
    };

    // Remove any existing chat between these users
    const filteredFromChats = fromUserChats.filter(chat => !(chat.withUser === toUser && !chat.isGroup));
    const filteredToChats = toUserChats.filter(chat => !(chat.withUser === fromUser && !chat.isGroup));

    filteredFromChats.push(newChat);
    filteredToChats.push(targetChat);

    chats.set(fromUser, filteredFromChats);
    chats.set(toUser, filteredToChats);

    // setup messages for this chat
    messages.set(chatId, []);

    // Save data after creating chat
    saveData();

    // Notify both users about the new chat
    const fromSocket = onlineUsers.get(fromUser);
    const toSocket = onlineUsers.get(toUser);

    if (fromSocket) {
      io.to(fromSocket).emit('chat_created', {
        with: toUser,
        chatId: chatId
      });
    }

    if (toSocket) {
      io.to(toSocket).emit('chat_created', {
        with: fromUser,
        chatId: chatId
      });
    }

    res.json({
      success: true,
      chatExists: true,
      chatId: chatId
    });
  } catch (error) {
    console.error('Start chat error:', error);
    res.json({ success: false, message: 'failed to start chat' });
  }
});

// Enhanced send message - Support both encrypted and group messages
app.post('/api/chats/message', (req, res) => {
  try {
    const { chatId, sender, text, encryptedData } = req.body;

    if (!chatId || !sender) {
      return res.json({ success: false, message: 'chat id and sender required' });
    }

    if (!text && !encryptedData) {
      return res.json({ success: false, message: 'either text or encrypted data required' });
    }

    if (!validateUsername(sender)) {
      return res.json({ support: false, message: 'invalid sender format' });
    }

    const chatMessages = messages.get(chatId) || [];

    // Check if this is a group chat
    const isGroupChat = groups.has(chatId);
    
    let message;
    
    if (isGroupChat) {
      // Group message - plain text
      const group = groups.get(chatId);
      if (!group.members.includes(sender)) {
        return res.json({ success: false, message: 'You are not a member of this group' });
      }
      
      message = {
        id: generateId(),
        chatId,
        sender,
        text: sanitizeInput(text),
        timestamp: new Date().toISOString(),
        type: 'group'
      };
    } else {
      // Direct message - encrypted
      message = {
        id: generateId(),
        chatId,
        sender,
        encryptedData: encryptedData, // Store encrypted data for direct messages
        text: text || '🔒 Encrypted message', // Use plain text for groups, encrypted indicator for direct
        timestamp: new Date().toISOString(),
        type: encryptedData ? 'encrypted' : 'text'
      };
    }

    chatMessages.push(message);
    messages.set(chatId, chatMessages);

    // Update last message in chats
    let lastMessageText;
    if (isGroupChat) {
      lastMessageText = text.length > 50 ? text.substring(0, 50) + '...' : text;
    } else {
      lastMessageText = encryptedData ? '🔒 Encrypted message' : (text.length > 50 ? text.substring(0, 50) + '...' : text);
    }
    
    updateChatLastMessage(chatId, lastMessageText, sender, isGroupChat);

    // Save data after sending message
    saveData();

    // notify everyone in the chat
    if (isGroupChat) {
      // Group message - notify all members
      const group = groups.get(chatId);
      group.members.forEach(member => {
        if (member !== sender) {
          const memberSocket = onlineUsers.get(member);
          if (memberSocket) {
            io.to(memberSocket).emit('new_message', message);
          }
        }
      });
    } else {
      // Direct message - find the other participant
      const userChats = Array.from(chats.entries()).find(([username, userChats]) => 
        userChats.some(chat => chat.id === chatId && chat.withUser !== sender)
      );
      
      if (userChats) {
        const [otherUser] = userChats;
        const otherUserSocket = onlineUsers.get(otherUser);
        if (otherUserSocket) {
          io.to(otherUserSocket).emit('new_message', message);
        }
      }
    }

    res.json({ success: true, message: 'message sent' });
  } catch (error) {
    console.error('Send message error:', error);
    res.json({ success: false, message: 'failed to send message' });
  }
});

// Enhanced file upload for chats
app.post('/api/chats/file', upload.single('file'), (req, res) => {
  try {
    const { chatId, sender, fileType, encryptedData } = req.body;
    const file = req.file;

    if (!chatId || !sender || !file) {
      return res.json({ success: false, message: 'chat id, sender, and file required' });
    }

    if (!validateUsername(sender)) {
      return res.json({ success: false, message: 'invalid sender format' });
    }

    const chatMessages = messages.get(chatId) || [];
    const isGroupChat = groups.has(chatId);
    
    const message = {
      id: generateId(),
      chatId,
      sender,
      text: encryptedData ? '🔒 Encrypted file' : `Sent a ${fileType}`,
      file: {
        originalname: file.originalname,
        filename: file.filename,
        path: `/uploads/${file.filename}`,
        size: file.size,
        type: fileType,
        encrypted: !!encryptedData
      },
      encryptedData: encryptedData,
      timestamp: new Date().toISOString(),
      type: isGroupChat ? 'group' : (encryptedData ? 'encrypted' : 'file')
    };

    chatMessages.push(message);
    messages.set(chatId, chatMessages);

    // Update last message in chats
    updateChatLastMessage(chatId, `${sender} sent a ${fileType}`, sender, isGroupChat);

    // Save data after sending file
    saveData();

    // notify everyone in the chat
    if (isGroupChat) {
      const group = groups.get(chatId);
      group.members.forEach(member => {
        if (member !== sender) {
          const memberSocket = onlineUsers.get(member);
          if (memberSocket) {
            io.to(memberSocket).emit('new_message', message);
          }
        }
      });
    } else {
      const userChats = Array.from(chats.entries()).find(([username, userChats]) => 
        userChats.some(chat => chat.id === chatId && chat.withUser !== sender)
      );
      
      if (userChats) {
        const [otherUser] = userChats;
        const otherUserSocket = onlineUsers.get(otherUser);
        if (otherUserSocket) {
          io.to(otherUserSocket).emit('new_message', message);
        }
      }
    }

    res.json({ success: true, message: 'file sent' });
  } catch (error) {
    console.error('File upload error:', error);
    res.json({ success: false, message: 'failed to send file' });
  }
});

function updateChatLastMessage(chatId, lastMessage, sender, isGroup = false) {
  if (isGroup) {
    // Update all group members' chats
    const group = groups.get(chatId);
    if (group) {
      group.members.forEach(member => {
        const userChats = chats.get(member) || [];
        const chatIndex = userChats.findIndex(chat => chat.id === chatId);
        if (chatIndex !== -1) {
          userChats[chatIndex].lastMessage = lastMessage;
          userChats[chatIndex].lastActivity = new Date().toISOString();
          chats.set(member, userChats);
        }
      });
    }
  } else {
    // Find and update the chat for both participants
    for (const [username, userChats] of chats.entries()) {
      const chatIndex = userChats.findIndex(chat => chat.id === chatId);
      if (chatIndex !== -1) {
        userChats[chatIndex].lastMessage = lastMessage;
        userChats[chatIndex].lastActivity = new Date().toISOString();
        chats.set(username, userChats);
      }
    }
  }
}

// get chat messages
app.get('/api/chats/:chatId/messages', (req, res) => {
  try {
    const { chatId } = req.params;
    const chatMessages = messages.get(chatId) || [];

    res.json({ success: true, messages: chatMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.json({ success: false, message: 'failed to load messages' });
  }
});

// get user chats
app.get('/api/chats/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const userChats = chats.get(username) || [];

    res.json({ success: true, chats: userChats });
  } catch (error) {
    console.error('Get chats error:', error);
    res.json({ success: false, message: 'failed to load chats' });
  }
});

// get pending requests
app.get('/api/requests/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const userRequests = pendingRequests.get(username) || [];

    res.json({ success: true, requests: userRequests });
  } catch (error) {
    console.error('Get requests error:', error);
    res.json({ success: false, message: 'failed to load requests' });
  }
});

// handle requests (accept/decline)
app.post('/api/requests/handle', (req, res) => {
  try {
    const { requestId, action } = req.body;

    if (!requestId || !action) {
      return res.json({ success: false, message: 'request id and action required' });
    }

    // find the request
    let foundRequest = null;
    let requestUser = null;

    for (const [username, requests] of pendingRequests) {
      const requestIndex = requests.findIndex(req => req.id === requestId);
      if (requestIndex !== -1) {
        foundRequest = requests[requestIndex];
        requestUser = username;
        requests.splice(requestIndex, 1);
        pendingRequests.set(username, requests);
        break;
      }
    }

    if (!foundRequest) {
      return res.json({ success: false, message: 'request not found' });
    }

    if (action === 'accept' && foundRequest.type === 'friend') {
      // add to friends list for both users
      const user1Friends = friends.get(foundRequest.fromUser) || [];
      const user2Friends = friends.get(foundRequest.toUser) || [];

      // Check if not already friends
      if (!user1Friends.find(f => f.username === foundRequest.toUser)) {
        user1Friends.push({
          username: foundRequest.toUser,
          since: new Date().toISOString()
        });
      }

      if (!user2Friends.find(f => f.username === foundRequest.fromUser)) {
        user2Friends.push({
          username: foundRequest.fromUser,
          since: new Date().toISOString()
        });
      }

      friends.set(foundRequest.fromUser, user1Friends);
      friends.set(foundRequest.toUser, user2Friends);

      // Create a chat between them if it doesn't exist
      const fromUserChats = chats.get(foundRequest.fromUser) || [];
      const toUserChats = chats.get(foundRequest.toUser) || [];

      if (!fromUserChats.find(chat => chat.withUser === foundRequest.toUser && !chat.isGroup)) {
        const chatId = generateId();
        
        fromUserChats.push({
          id: chatId,
          withUser: foundRequest.toUser,
          avatar: getUserByUsername(foundRequest.toUser)?.avatar || null,
          lastMessage: `You are now friends with ${foundRequest.toUser}`,
          lastActivity: new Date().toISOString(),
          pinned: false,
          blocked: false,
          encrypted: true,
          isGroup: false
        });

        toUserChats.push({
          id: chatId,
          withUser: foundRequest.fromUser,
          avatar: getUserByUsername(foundRequest.fromUser)?.avatar || null,
          lastMessage: `You are now friends with ${foundRequest.fromUser}`,
          lastActivity: new Date().toISOString(),
          pinned: false,
          blocked: false,
          encrypted: true,
          isGroup: false
        });

        chats.set(foundRequest.fromUser, fromUserChats);
        chats.set(foundRequest.toUser, toUserChats);

        // Create initial message
        messages.set(chatId, [{
          id: generateId(),
          chatId: chatId,
          sender: 'system',
          text: `You are now friends! Start chatting with ${foundRequest.fromUser}`,
          timestamp: new Date().toISOString(),
          type: 'system'
        }]);
      }
    }

    // Save data after handling request
    saveData();

    // Notify the requester if online
    const requesterSocket = onlineUsers.get(foundRequest.fromUser);
    if (requesterSocket) {
      io.to(requesterSocket).emit('request_handled', {
        requestId: requestId,
        action: action,
        fromUser: foundRequest.toUser
      });
    }

    res.json({ success: true, message: `request ${action}ed` });
  } catch (error) {
    console.error('Handle request error:', error);
    res.json({ success: false, message: 'failed to handle request' });
  }
});

// Enhanced update profile
app.post('/api/profile/update', upload.single('profilePicture'), async (req, res) => {
  try {
    const { username, currentPassword, newPassword, newUsername } = req.body;
    const profilePicture = req.file;

    if (!username) {
      return res.json({ success: false, message: 'username required' });
    }

    if (!validateUsername(username)) {
      return res.json({ success: false, message: 'invalid username format' });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.json({ success: false, message: 'user not found' });
    }

    // Handle username change
    if (newUsername && newUsername !== username) {
      if (!validateUsername(newUsername)) {
        return res.json({ success: false, message: 'new username must be 3-20 characters and contain only letters, numbers, and underscores' });
      }

      if (users.has(newUsername)) {
        return res.json({ success: false, message: 'username not available, try another one' });
      }

      // Update username in all data structures
      users.delete(username);
      user.username = newUsername;
      saveUser(user);

      // Update friends lists
      for (const [friendUsername, friendList] of friends) {
        const updatedFriendList = friendList.map(friend => 
          friend.username === username ? { ...friend, username: newUsername } : friend
        );
        friends.set(friendUsername, updatedFriendList);
      }

      // Update chats
      for (const [chatUsername, chatList] of chats) {
        const updatedChatList = chatList.map(chat => 
          chat.withUser === username ? { ...chat, withUser: newUsername } : chat
        );
        chats.set(chatUsername, updatedChatList);
      }

      // Update groups
      for (const [groupId, group] of groups) {
        if (group.members.includes(username)) {
          group.members = group.members.map(member => 
            member === username ? newUsername : member
          );
          groups.set(groupId, group);
        }
        if (group.creator === username) {
          group.creator = newUsername;
          groups.set(groupId, group);
        }
      }

      // Update pending requests
      for (const [requestUsername, requestList] of pendingRequests) {
        const updatedRequestList = requestList.map(request => ({
          ...request,
          fromUser: request.fromUser === username ? newUsername : request.fromUser,
          toUser: request.toUser === username ? newUsername : request.toUser
        }));
        pendingRequests.set(requestUsername, updatedRequestList);
      }

      // Update online users
      if (onlineUsers.has(username)) {
        onlineUsers.set(newUsername, onlineUsers.get(username));
        onlineUsers.delete(username);
      }
    }

    // update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res.json({ success: false, message: 'current password required' });
      }

      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.json({ success: false, message: 'current password is wrong' });
      }

      if (!validatePassword(newPassword)) {
        return res.json({ success: false, message: 'new password needs to be at least 8 characters' });
      }

      user.password = await bcrypt.hash(newPassword, 12);
    }

    // update profile picture
    if (profilePicture) {
      user.avatar = `/uploads/${profilePicture.filename}`;
    }

    saveUser(user);

    // Save data after profile update
    saveData();

    // return updated user (no password)
    const userData = { ...user };
    delete userData.password;

    res.json({
      success: true,
      message: 'profile updated',
      user: userData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.json({ success: false, message: 'failed to update profile' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    users: users.size,
    friends: Array.from(friends.values()).reduce((acc, curr) => acc + curr.length, 0),
    groups: groups.size,
    chats: Array.from(chats.values()).reduce((acc, curr) => acc + curr.length, 0),
    uptime: process.uptime()
  });
});

// serve uploaded files
app.use('/uploads', express.static('uploads'));

// Connection management for DDOS protection
const connectionLimits = new Map();
const MAX_CONNECTIONS_PER_IP = 10;

// Enhanced websocket connections with DDOS protection
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;

  // DDOS protection
  const ipConnections = connectionLimits.get(clientIp) || 0;
  if (ipConnections >= MAX_CONNECTIONS_PER_IP) {
    socket.disconnect(true);
    return;
  }

  connectionLimits.set(clientIp, ipConnections + 1);
  console.log('user connected:', socket.id, 'from IP:', clientIp);

  socket.on('user_online', (username) => {
    if (!validateUsername(username)) {
      socket.disconnect(true);
      return;
    }

    onlineUsers.set(username, socket.id);

    // notify friends
    const userFriends = friends.get(username) || [];
    userFriends.forEach(friend => {
      const friendSocket = onlineUsers.get(friend.username);
      if (friendSocket) {
        io.to(friendSocket).emit('friend_online', { username });
      }
    });

    // notify group members
    for (const [groupId, group] of groups.entries()) {
      if (group.members.includes(username)) {
        group.members.forEach(member => {
          if (member !== username) {
            const memberSocket = onlineUsers.get(member);
            if (memberSocket) {
              io.to(memberSocket).emit('group_member_online', {
                groupId: groupId,
                username: username
              });
            }
          }
        });
      }
    }
  });

  // Enhanced Group WebSocket events
  socket.on('group_created', (data) => {
    // Notify members about new group
    const { groupId } = data;
    const group = groups.get(groupId);
    if (group) {
      group.members.forEach(member => {
        const memberSocket = onlineUsers.get(member);
        if (memberSocket && memberSocket !== socket.id) {
          io.to(memberSocket).emit('group_created', {
            groupId: groupId,
            groupName: group.name,
            creator: group.creator
          });
        }
      });
    }
  });

  socket.on('group_message', (data) => {
    // Handle real-time group messages
    const { groupId } = data;
    const group = groups.get(groupId);
    if (group) {
      group.members.forEach(member => {
        const memberSocket = onlineUsers.get(member);
        if (memberSocket && memberSocket !== socket.id) {
          io.to(memberSocket).emit('group_message', data);
        }
      });
    }
  });

  socket.on('disconnect', (reason) => {
    // Clean up connection limits
    const ipConnections = connectionLimits.get(clientIp) || 1;
    connectionLimits.set(clientIp, ipConnections - 1);

    if (connectionLimits.get(clientIp) <= 0) {
      connectionLimits.delete(clientIp);
    }

    // find and remove disconnected user
    for (const [username, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(username);

        // notify friends
        const userFriends = friends.get(username) || [];
        userFriends.forEach(friend => {
          const friendSocket = onlineUsers.get(friend.username);
          if (friendSocket) {
            io.to(friendSocket).emit('friend_offline', { username });
          }
        });

        // notify group members
        for (const [groupId, group] of groups.entries()) {
          if (group.members.includes(username)) {
            group.members.forEach(member => {
              if (member !== username) {
                const memberSocket = onlineUsers.get(member);
                if (memberSocket) {
                  io.to(memberSocket).emit('group_member_offline', {
                    groupId: groupId,
                    username: username
                  });
                }
              }
            });
          }
        }
        break;
      }
    }

    console.log('user disconnected:', socket.id, 'reason:', reason);
  });
});

// serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.port || 3000;
server.listen(port, () => {
  console.log(`server running on port ${port}`);
  console.log('ghostshare backend is ready!');
  console.log('Security features:');
  console.log('- Rate limiting enabled');
  console.log('- Helmet security headers');
  console.log('- E2E encryption ready');
  console.log('- DDOS protection active');
  console.log('- Input validation enabled');
  console.log('- Enhanced group system implemented');
  console.log('- Enhanced friend system implemented');

  // create uploads folder if it doesn't exist
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
});
