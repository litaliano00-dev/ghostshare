// Application State
let currentUser = null;
let friends = [];
let groups = [];
let chats = [];
let activeChat = null;
let socket = null;
let pendingRequests = [];
let longPressTimer = null;
let selectedChat = null;
let encryptionKeys = new Map();

// Enhanced Particle System
function createParticles() {
    const container = document.getElementById('bg-particles');
    const particleCount = 30; // Reduced for mobile performance

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';

        const size = Math.random() * 3 + 1;
        const posX = Math.random() * 100;
        const posY = Math.random() * 100;
        const duration = Math.random() * 20 + 10;
        const delay = Math.random() * 5;

        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${posX}%`;
        particle.style.top = `${posY}%`;
        particle.style.animation = `float ${duration}s ease-in-out ${delay}s infinite`;

        container.appendChild(particle);
    }

    // Add floating animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes float {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            25% { transform: translate(20px, -20px) rotate(90deg); }
            50% { transform: translate(0, -40px) rotate(180deg); }
            75% { transform: translate(-20px, -20px) rotate(270deg); }
        }
    `;
    document.head.appendChild(style);
}

// FIXED E2E Encryption Functions - Consistent Key Derivation
async function generateEncryptionKey() {
    const key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    return key;
}

async function deriveChatKey(userId1, userId2) {
    // FIXED: Sort user IDs for consistent key derivation
    const sortedUserIds = [userId1, userId2].sort();
    const encoder = new TextEncoder();
    const data = encoder.encode(sortedUserIds[0] + sortedUserIds[1] + 'ghostshare-secret-salt-v2');
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return await window.crypto.subtle.importKey(
        'raw',
        hash,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptMessage(text, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );

    return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted))
    };
}

async function decryptMessage(encryptedData, key) {
    try {
        const iv = new Uint8Array(encryptedData.iv);
        const data = new Uint8Array(encryptedData.data);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        console.error('Decryption failed:', error);
        return '🔒 Unable to decrypt message';
    }
}

function getChatKey(chatId, user1, user2) {
    // FIXED: Use sorted user IDs for consistent key lookup
    const keyId = [user1, user2].sort().join('-');
    if (!encryptionKeys.has(keyId)) {
        const keyPromise = deriveChatKey(user1, user2);
        encryptionKeys.set(keyId, keyPromise);
    }
    return encryptionKeys.get(keyId);
}

// Modal System
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
    gsap.from(`#${modalId} .modal-content`, { duration: 0.5, scale: 0.8, opacity: 0 });
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Notification System
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    const messageEl = document.getElementById('notification-message');

    messageEl.textContent = message;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Enhanced Authentication System
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.auth-tab:${tab === 'login' ? 'first-child' : 'last-child'}`).classList.add('active');

    document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';

    // Animation
    gsap.from(`#${tab}-form`, { duration: 0.5, y: 20, opacity: 0 });
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    // Show loading state
    const btn = document.querySelector('#login-form .btn span');
    btn.innerHTML = 'Verifying Identity <span class="loading-dots"><span></span><span></span><span></span></span>';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = data.user;
            initializeApp();
        } else {
            showNotification(data.message, 'error');
            btn.innerHTML = 'Access Secure Network';
        }
    } catch (error) {
        showNotification('Login failed. Please try again.', 'error');
        btn.innerHTML = 'Access Secure Network';
    }
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    if (!username || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    if (password !== confirmPassword) {
        showNotification('Passwords do not match!', 'error');
        return;
    }

    if (password.length < 8) {
        showNotification('Password must be at least 8 characters long!', 'error');
        return;
    }

    // Show loading state
    const btn = document.querySelector('#register-form .btn span');
    btn.innerHTML = 'Creating Secure Account <span class="loading-dots"><span></span><span></span><span></span></span>';

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Account created successfully! Please login.');
            switchAuthTab('login');
        } else {
            if (data.message.includes('already exists')) {
                showNotification('Username not available, try another one', 'error');
            } else {
                showNotification(data.message, 'error');
            }
        }
    } catch (error) {
        showNotification('Registration failed. Please try again.', 'error');
    } finally {
        btn.innerHTML = 'Create Secure Account';
    }
}

function initializeApp() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';

    // Initialize user data
    updateUserAvatar();
    loadFriends();
    loadGroups();
    loadChats();
    loadPendingRequests();

    // Connect to WebSocket
    socket = io();
    setupSocketListeners();

    // Notify server that user is online
    socket.emit('user_online', currentUser.username);

    // Animate app entrance
    gsap.from('#app-container', { duration: 1, y: 50, opacity: 0, ease: 'back.out(1.7)' });

    // Initialize encryption for existing chats
    initializeEncryption();
}

async function initializeEncryption() {
    // Pre-generate encryption keys for all existing chats
    for (const chat of chats) {
        await getChatKey(chat.id, currentUser.username, chat.withUser);
    }
}

function updateUserAvatar() {
    const avatar = document.getElementById('user-avatar');
    if (currentUser && currentUser.avatar) {
        avatar.innerHTML = `<img src="${currentUser.avatar}" alt="Profile">`;
    } else {
        avatar.innerHTML = '<i class="fas fa-user-shield"></i>';
    }
}

// View Management
function switchView(view) {
    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    event.target.closest('.nav-item').classList.add('active');

    // Hide all views
    document.getElementById('chat-welcome').style.display = 'none';
    document.getElementById('chats-view').style.display = 'none';
    document.getElementById('friends-view').style.display = 'none';
    document.getElementById('groups-view').style.display = 'none';
    document.getElementById('active-chat').style.display = 'none';
    document.getElementById('message-input').style.display = 'none';

    // Show selected view
    switch(view) {
        case 'chats':
            document.getElementById('chats-view').style.display = 'block';
            if (activeChat) {
                document.getElementById('active-chat').style.display = 'block';
                document.getElementById('message-input').style.display = 'flex';
            } else {
                document.getElementById('chat-welcome').style.display = 'block';
            }
            break;
        case 'friends':
            document.getElementById('friends-view').style.display = 'block';
            break;
        case 'groups':
            document.getElementById('groups-view').style.display = 'block';
            break;
    }
}

// Enhanced Friend System
function showAddFriendModal() {
    showModal('add-friend-modal');
}

async function sendFriendRequest() {
    const friendUsername = document.getElementById('friend-username').value.trim();
    const message = document.getElementById('friend-message').value.trim();

    if (!friendUsername) {
        showNotification('Please enter a username', 'error');
        return;
    }

    if (friendUsername === currentUser.username) {
        showNotification('You cannot add yourself as a friend', 'error');
        return;
    }

    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: currentUser.username, 
                friendUsername,
                message: message || undefined
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Friend request sent!');
            closeModal('add-friend-modal');
            document.getElementById('friend-username').value = '';
            document.getElementById('friend-message').value = '';
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('Failed to send friend request', 'error');
    }
}

async function loadFriends() {
    try {
        const response = await fetch(`/api/friends/${currentUser.username}`);
        const data = await response.json();

        if (data.success) {
            friends = data.friends;
            renderFriendsList();
        }
    } catch (error) {
        console.error('Failed to load friends:', error);
    }
}

function renderFriendsList() {
    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = '';

    if (friends.length === 0) {
        friendsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-size: 0.85rem;">No friends yet</p>';
        return;
    }

    friends.forEach(friend => {
        const friendItem = document.createElement('div');
        friendItem.className = 'friend-item glass';
        friendItem.onclick = () => openFriendChat(friend.username);

        friendItem.innerHTML = `
            <div class="friend-avatar" onclick="event.stopPropagation(); openFriendChat('${friend.username}')">
                ${friend.avatar ? `<img src="${friend.avatar}" alt="${friend.username}">` : '<i class="fas fa-user"></i>'}
            </div>
            <div class="friend-info">
                <div class="friend-name">${friend.username}</div>
                <div class="friend-status ${friend.online ? 'status-online' : 'status-offline'}">
                    ${friend.online ? 'Online' : 'Offline'}
                </div>
                ${friend.since ? `<div style="font-size: 0.7rem; color: var(--text-secondary);">Friends since ${new Date(friend.since).toLocaleDateString()}</div>` : ''}
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="option-btn" onclick="event.stopPropagation(); removeFriend('${friend.username}')" title="Remove Friend">
                    <i class="fas fa-user-minus"></i>
                </button>
            </div>
        `;
        friendsList.appendChild(friendItem);
    });
}

async function removeFriend(friendUsername) {
    if (!confirm(`Are you sure you want to remove ${friendUsername} from your friends?`)) {
        return;
    }

    try {
        const response = await fetch('/api/friends/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUser.username,
                friendUsername: friendUsername
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Removed ${friendUsername} from friends`);
            loadFriends();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('Failed to remove friend', 'error');
    }
}

// Enhanced Group System
function showCreateGroupModal() {
    // Populate friends checkboxes
    const checkboxesContainer = document.getElementById('friends-checkboxes');
    checkboxesContainer.innerHTML = '';

    if (friends.length === 0) {
        checkboxesContainer.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem; text-align: center;">No friends to add to group</p>';
        return;
    }

    friends.forEach(friend => {
        const checkbox = document.createElement('div');
        checkbox.className = 'group-member-item';
        checkbox.innerHTML = `
            <label style="display: flex; align-items: center; cursor: pointer; width: 100%;">
                <input type="checkbox" value="${friend.username}" style="margin-right: 10px;">
                <div class="group-member-avatar">
                    ${friend.avatar ? `<img src="${friend.avatar}" alt="${friend.username}" style="width: 100%; height: 100%; object-fit: cover;">` : '<i class="fas fa-user"></i>'}
                </div>
                <div class="group-member-name">${friend.username}</div>
                <div class="friend-status ${friend.online ? 'status-online' : 'status-offline'}" style="font-size: 0.7rem;">
                    ${friend.online ? 'Online' : 'Offline'}
                </div>
            </label>
        `;
        checkboxesContainer.appendChild(checkbox);
    });

    showModal('create-group-modal');
}

async function createGroup() {
    const groupName = document.getElementById('group-name').value.trim();
    const groupDescription = document.getElementById('group-description').value.trim();
    const selectedFriends = Array.from(document.querySelectorAll('#friends-checkboxes input:checked'))
        .map(checkbox => checkbox.value);

    if (!groupName) {
        showNotification('Please enter a group name', 'error');
        return;
    }

    if (selectedFriends.length === 0) {
        showNotification('Please select at least one friend', 'error');
        return;
    }

    try {
        const response = await fetch('/api/groups/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: groupName,
                description: groupDescription,
                creator: currentUser.username,
                members: [currentUser.username, ...selectedFriends]
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Group created successfully!');
            closeModal('create-group-modal');
            document.getElementById('group-name').value = '';
            document.getElementById('group-description').value = '';
            loadGroups();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('Failed to create group', 'error');
    }
}

async function loadGroups() {
    try {
        const response = await fetch(`/api/groups/${currentUser.username}`);
        const data = await response.json();

        if (data.success) {
            groups = data.groups;
            renderGroupsList();
        }
    } catch (error) {
        console.error('Failed to load groups:', error);
    }
}

function renderGroupsList() {
    const groupsList = document.getElementById('groups-list');
    groupsList.innerHTML = '';

    if (groups.length === 0) {
        groupsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-size: 0.85rem;">No groups yet</p>';
        return;
    }

    groups.forEach(group => {
        const groupItem = document.createElement('div');
        groupItem.className = 'group-item glass';
        groupItem.onclick = () => openGroupChat(group.id, group.name);

        groupItem.innerHTML = `
            <div class="group-avatar" onclick="event.stopPropagation(); openGroupChat('${group.id}', '${group.name}')">
                <i class="fas fa-layer-group"></i>
            </div>
            <div class="group-info">
                <div class="group-name">${group.name}</div>
                <div class="group-members">${group.memberCount || group.members.length} members • Created by ${group.creator}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">Last active: ${new Date(group.lastActivity).toLocaleDateString()}</div>
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="option-btn" onclick="event.stopPropagation(); showGroupInfo('${group.id}')" title="Group Info">
                    <i class="fas fa-info-circle"></i>
                </button>
            </div>
        `;
        groupsList.appendChild(groupItem);
    });
}

function showGroupInfo(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    document.getElementById('group-info-title').textContent = group.name;
    const content = document.getElementById('group-info-content');

    content.innerHTML = `
        <div style="text-align: center; margin-bottom: 15px;">
            <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; font-size: 2rem;">
                <i class="fas fa-layer-group"></i>
            </div>
            <h4 style="margin-bottom: 5px;">${group.name}</h4>
            ${group.description ? `<p style="color: var(--text-secondary); font-size: 0.85rem;">${group.description}</p>` : ''}
        </div>

        <div class="form-group">
            <label class="form-label">Group Members (${group.memberCount || group.members.length})</label>
            <div class="group-members-list">
                ${group.members.map(member => `
                    <div class="group-member-item">
                        <div class="group-member-avatar">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="group-member-name">${member}</div>
                        ${member === group.creator ? '<div class="group-member-role">Creator</div>' : ''}
                        ${member === currentUser.username ? '<div class="group-member-role">You</div>' : ''}
                    </div>
                `).join('')}
            </div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="btn-secondary" onclick="leaveGroup('${group.id}')" style="flex: 1;">Leave Group</button>
            ${group.creator === currentUser.username ? 
                `<button class="btn" onclick="deleteGroup('${group.id}')" style="flex: 1;">Delete Group</button>` : 
                ''
            }
        </div>
    `;

    showModal('group-info-modal');
}

async function leaveGroup(groupId) {
    if (!confirm('Are you sure you want to leave this group?')) {
        return;
    }

    try {
        const response = await fetch('/api/groups/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: groupId,
                username: currentUser.username
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('You have left the group');
            closeModal('group-info-modal');
            loadGroups();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('Failed to leave group', 'error');
    }
}

async function deleteGroup(groupId) {
    if (!confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch('/api/groups/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: groupId,
                username: currentUser.username
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Group deleted successfully');
            closeModal('group-info-modal');
            loadGroups();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('Failed to delete group', 'error');
    }
}

// Chat System
function createNewChat() {
    showModal('new-chat-modal');
}

async function startNewChat() {
    const username = document.getElementById('chat-username').value.trim();

    if (!username) {
        showNotification('Please enter a username', 'error');
        return;
    }

    if (username === currentUser.username) {
        showNotification('You cannot chat with yourself', 'error');
        return;
    }

    try {
        const response = await fetch('/api/chats/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromUser: currentUser.username,
                toUser: username
            })
        });

        const data = await response.json();

        if (data.success) {
            if (data.chatExists) {
                // Open existing chat
                openChat(data.chatId, username);
                showNotification('Chat opened!');
            } else {
                // Send chat request
                showNotification('Chat request sent!');
            }
            closeModal('new-chat-modal');
            document.getElementById('chat-username').value = '';
            loadChats();
        } else {
            if (data.message.includes('not found')) {
                showNotification('Username not found. Try again.', 'error');
            } else {
                showNotification(data.message, 'error');
            }
        }
    } catch (error) {
        showNotification('Failed to start chat', 'error');
    }
}

async function loadChats() {
    try {
        const response = await fetch(`/api/chats/${currentUser.username}`);
        const data = await response.json();

        if (data.success) {
            chats = data.chats;
            renderChatsList();
        }
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

function renderChatsList() {
    const chatsList = document.getElementById('chats-list');
    chatsList.innerHTML = '';

    if (chats.length === 0) {
        chatsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-size: 0.85rem;">No chats yet</p>';
        return;
    }

    // Sort chats: pinned first, then by last activity
    const sortedChats = [...chats].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.lastActivity) - new Date(a.lastActivity);
    });

    sortedChats.forEach(chat => {
        const chatButton = document.createElement('button');
        chatButton.className = `chat-button glass ${chat.pinned ? 'pinned' : ''} ${chat.blocked ? 'blocked' : ''}`;
        chatButton.setAttribute('data-chat-id', chat.id);
        chatButton.setAttribute('data-username', chat.withUser);

        chatButton.innerHTML = `
            <div class="friend-avatar" onclick="event.stopPropagation(); openChat('${chat.id}', '${chat.withUser}')">
                ${chat.avatar ? `<img src="${chat.avatar}" alt="${chat.withUser}">` : 
                  chat.isGroup ? '<i class="fas fa-layer-group"></i>' : '<i class="fas fa-user"></i>'}
            </div>
            <div class="friend-info">
                <div class="friend-name">${chat.withUser} ${chat.isGroup ? '<i class="fas fa-users" style="font-size: 0.7rem; margin-left: 5px;"></i>' : ''}</div>
                <div class="friend-status">${chat.lastMessage || 'No messages yet'}</div>
                <div class="encryption-status">
                    <i class="fas fa-lock"></i>
                    <span>End-to-End Encrypted</span>
                </div>
            </div>
            <div class="chat-options">
                <button class="option-btn" onclick="event.stopPropagation(); togglePin('${chat.id}')">
                    <i class="fas fa-thumbtack"></i>
                </button>
                <button class="option-btn" onclick="event.stopPropagation(); toggleBlock('${chat.id}')">
                    <i class="fas fa-ban"></i>
                </button>
            </div>
        `;

        // Add click event
        chatButton.addEventListener('click', () => openChat(chat.id, chat.withUser, chat.isGroup));

        // Add long press event
        chatButton.addEventListener('mousedown', startLongPress);
        chatButton.addEventListener('touchstart', startLongPress);
        chatButton.addEventListener('mouseup', cancelLongPress);
        chatButton.addEventListener('mouseleave', cancelLongPress);
        chatButton.addEventListener('touchend', cancelLongPress);

        chatsList.appendChild(chatButton);
    });
}

function openFriendChat(username) {
    // Find existing chat with this friend
    const existingChat = chats.find(chat => chat.withUser === username);
    if (existingChat) {
        openChat(existingChat.id, username);
    } else {
        // Create a new chat
        startNewChatWithUser(username);
    }
}

function openGroupChat(groupId, groupName) {
    openChat(groupId, groupName, true);
}

async function startNewChatWithUser(username) {
    try {
        const response = await fetch('/api/chats/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromUser: currentUser.username,
                toUser: username
            })
        });

        const data = await response.json();

        if (data.success && data.chatExists) {
            openChat(data.chatId, username);
            loadChats();
        }
    } catch (error) {
        console.error('Failed to start chat:', error);
    }
}

async function openChat(chatId, username, isGroup = false) {
    activeChat = { id: chatId, username: username, isGroup: isGroup };

    // Update UI
    document.getElementById('chat-welcome').style.display = 'none';
    document.getElementById('chats-view').style.display = 'none';
    document.getElementById('friends-view').style.display = 'none';
    document.getElementById('groups-view').style.display = 'none';
    document.getElementById('active-chat').style.display = 'block';
    document.getElementById('message-input').style.display = 'flex';

    // Update chat header
    document.getElementById('active-chat-name').textContent = username;
    document.getElementById('active-chat-status').textContent = isGroup ? 'Group' : 'Online';

    // Update avatar in header
    const chat = chats.find(c => c.id === chatId);
    const avatarEl = document.getElementById('active-chat-avatar');
    if (chat && chat.avatar) {
        avatarEl.innerHTML = `<img src="${chat.avatar}" alt="${username}">`;
    } else {
        avatarEl.innerHTML = isGroup ? '<i class="fas fa-layer-group"></i>' : '<i class="fas fa-user"></i>';
    }

    // Pre-generate encryption key for this chat (only for direct messages)
    if (!isGroup) {
        await getChatKey(chatId, currentUser.username, username);
    }

    // Load chat messages
    loadChatMessages(chatId);
}

async function loadChatMessages(chatId) {
    try {
        const response = await fetch(`/api/chats/${chatId}/messages`);
        const data = await response.json();

        if (data.success) {
            await renderMessages(data.messages);
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

async function renderMessages(messages) {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        messagesContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 0.85rem;">No messages yet. Start the conversation!</p>';
        return;
    }

    for (const message of messages) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${message.sender === currentUser.username ? 'outgoing' : 'incoming'}`;

        let messageContent = '';

        if (message.encryptedData && message.type === 'encrypted') {
            // Handle encrypted messages - FIXED: Use proper decryption
            try {
                const key = await getChatKey(message.chatId, currentUser.username, activeChat.username);
                const decryptedText = await decryptMessage(message.encryptedData, key);
                messageContent = `<div class="message-text">${escapeHtml(decryptedText)}</div>`;
            } catch (error) {
                console.error('Decryption failed:', error);
                messageContent = `<div class="message-text">🔒 Unable to decrypt message</div>`;
            }
        } else if (message.file) {
            // Handle file messages
            messageContent = `
                <div class="message-text">${message.text}</div>
                <div class="file-message">
                    <div class="file-icon">
                        <i class="fas fa-${getFileIcon(message.file.type)}"></i>
                    </div>
                    <div class="file-info">
                        <div class="file-name">${message.file.originalname}</div>
                        <div class="file-size">${getFileSize(message.file.size)}</div>
                    </div>
                    <button class="download-btn" onclick="downloadFile('${message.file.path}', '${message.file.originalname}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            `;
        } else {
            // Handle plain text (legacy) messages
            messageContent = `<div class="message-text">${escapeHtml(message.text)}</div>`;
        }

        messageEl.innerHTML = `
            ${message.sender !== currentUser.username ? `<div class="message-sender">${message.sender}</div>` : ''}
            ${messageContent}
            <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
        `;
        messagesContainer.appendChild(messageEl);
    }

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// File handling functions
function getFileIcon(fileType) {
    switch(fileType) {
        case 'image': return 'image';
        case 'video': return 'video';
        default: return 'file';
    }
}

function getFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function downloadFile(path, filename) {
    const link = document.createElement('a');
    link.href = path;
    link.download = filename;
    link.click();
}

function toggleFileOptions() {
    const options = document.getElementById('file-options');
    options.style.display = options.style.display === 'flex' ? 'none' : 'flex';
}

function selectFile(type) {
    const fileInput = document.getElementById(`${type}-input`);
    fileInput.onchange = () => uploadFile(type, fileInput.files[0]);
    fileInput.click();
    toggleFileOptions();
}

async function uploadFile(type, file) {
    if (!file || !activeChat) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', activeChat.id);
    formData.append('sender', currentUser.username);
    formData.append('fileType', type);

    try {
        const response = await fetch('/api/chats/file', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            loadChatMessages(activeChat.id);
            loadChats();
        } else {
            showNotification('Failed to send file', 'error');
        }
    } catch (error) {
        showNotification('Failed to send file', 'error');
    }
}

// Security: HTML escaping
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// FIXED: Enhanced sendMessage with proper encryption
async function sendMessage() {
    const messageText = document.getElementById('message-text').value.trim();

    if (!messageText || !activeChat) return;

    if (messageText.length > 1000) {
        showNotification('Message too long (max 1000 characters)', 'error');
        return;
    }

    try {
        let encryptedData = null;

        // Only encrypt direct messages, not group messages
        if (!activeChat.isGroup) {
            const key = await getChatKey(activeChat.id, currentUser.username, activeChat.username);
            encryptedData = await encryptMessage(messageText, key);
        }

        const response = await fetch('/api/chats/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: activeChat.id,
                sender: currentUser.username,
                text: activeChat.isGroup ? messageText : null, // Send plain text for groups
                encryptedData: activeChat.isGroup ? null : encryptedData // Send encrypted for direct messages
            })
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('message-text').value = '';
            loadChatMessages(activeChat.id);
            loadChats(); // Update chat list with last message
        } else {
            showNotification('Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Message sending error:', error);
        showNotification('Failed to send message', 'error');
    }
}

// Notifications System
function showNotifications() {
    showModal('notifications-modal');
    renderNotifications();
}

function renderNotifications() {
    const notificationsList = document.getElementById('notifications-list');
    notificationsList.innerHTML = '';

    if (pendingRequests.length === 0) {
        notificationsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-size: 0.85rem;">No new notifications</p>';
        return;
    }

    pendingRequests.forEach(request => {
        const notificationItem = document.createElement('div');
        notificationItem.className = 'friend-item glass';
        notificationItem.innerHTML = `
            <div class="friend-info">
                <div class="friend-name">${escapeHtml(request.fromUser)}</div>
                <div class="friend-status">${request.type === 'friend' ? 'Friend Request' : 'Chat Request'}</div>
                ${request.message ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 5px;">${request.message}</div>` : ''}
                <div class="request-buttons">
                    <button class="accept-btn" onclick="handleRequest('${request.id}', 'accept')">✔️ Accept</button>
                    <button class="decline-btn" onclick="handleRequest('${request.id}', 'decline')">🚫 Decline</button>
                </div>
            </div>
        `;
        notificationsList.appendChild(notificationItem);
    });
}

async function loadPendingRequests() {
    try {
        const response = await fetch(`/api/requests/${currentUser.username}`);
        const data = await response.json();

        if (data.success) {
            pendingRequests = data.requests;
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('Failed to load requests:', error);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (pendingRequests.length > 0) {
        badge.textContent = pendingRequests.length > 9 ? '9+' : pendingRequests.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

async function handleRequest(requestId, action) {
    try {
        const response = await fetch('/api/requests/handle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestId,
                action
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Request ${action}ed`);
            loadPendingRequests();
            if (action === 'accept') {
                loadFriends();
                loadChats();
            }
        }
    } catch (error) {
        console.error('Failed to handle request:', error);
    }
}

// Long Press Context Menu
function startLongPress(event) {
    const chatButton = event.currentTarget;
    selectedChat = {
        id: chatButton.getAttribute('data-chat-id'),
        username: chatButton.getAttribute('data-username')
    };

    longPressTimer = setTimeout(() => {
        showContextMenu(event);
    }, 500);
}

function cancelLongPress() {
    clearTimeout(longPressTimer);
}

function showContextMenu(event) {
    const contextMenu = document.getElementById('context-menu');
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${event.clientX}px`;
    contextMenu.style.top = `${event.clientY}px`;

    // Hide context menu when clicking elsewhere
    document.addEventListener('click', hideContextMenu);
}

function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    contextMenu.style.display = 'none';
    document.removeEventListener('click', hideContextMenu);
}

function pinChat() {
    if (!selectedChat) return;
    // Implement pin functionality
    showNotification('Chat pinned');
    hideContextMenu();
}

function unpinChat() {
    if (!selectedChat) return;
    // Implement unpin functionality
    showNotification('Chat unpinned');
    hideContextMenu();
}

function blockUser() {
    if (!selectedChat) return;
    // Implement block functionality
    showNotification('User blocked');
    hideContextMenu();
}

function unblockUser() {
    if (!selectedChat) return;
    // Implement unblock functionality
    showNotification('User unblocked');
    hideContextMenu();
}

// Profile System
function showUserProfile() {
    // Set current username in profile form
    document.getElementById('profile-username').value = currentUser.username;
    showModal('profile-modal');

    // Setup profile picture upload
    const fileInput = document.getElementById('profile-picture');
    const preview = document.getElementById('profile-preview');

    fileInput.onchange = function(event) {
        const file = event.target.files[0];
        if (file) {
            // Validate file size
            if (file.size > 5 * 1024 * 1024) {
                showNotification('File too large (max 5MB)', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                preview.innerHTML = `<img src="${e.target.result}" alt="Profile Preview">`;
            };
            reader.readAsDataURL(file);
        }
    };
}

function enableUsernameEdit() {
    const usernameInput = document.getElementById('profile-username');
    usernameInput.readOnly = false;
    usernameInput.focus();
}

async function updateProfile() {
    const usernameInput = document.getElementById('profile-username');
    const newUsername = usernameInput.value.trim();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;
    const profilePicture = document.getElementById('profile-picture').files[0];

    let updates = {};

    // Check if username changed
    if (newUsername !== currentUser.username) {
        if (newUsername.length < 3 || newUsername.length > 20) {
            showNotification('Username must be between 3-20 characters', 'error');
            return;
        }
        updates.newUsername = newUsername;
    }

    // Validate password change
    if (newPassword) {
        if (!currentPassword) {
            showNotification('Current password is required to change password', 'error');
            return;
        }

        if (newPassword !== confirmNewPassword) {
            showNotification('New passwords do not match!', 'error');
            return;
        }

        if (newPassword.length < 8) {
            showNotification('New password must be at least 8 characters long!', 'error');
            return;
        }

        updates.newPassword = newPassword;
        updates.currentPassword = currentPassword;
    }

    try {
        const formData = new FormData();
        formData.append('username', currentUser.username);

        if (updates.newUsername) {
            formData.append('newUsername', updates.newUsername);
        }
        if (updates.currentPassword) {
            formData.append('currentPassword', updates.currentPassword);
        }
        if (updates.newPassword) {
            formData.append('newPassword', updates.newPassword);
        }

        if (profilePicture) {
            formData.append('profilePicture', profilePicture);
        }

        const response = await fetch('/api/profile/update', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Profile updated successfully!');
            closeModal('profile-modal');

            // Clear form
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-new-password').value = '';
            usernameInput.readOnly = true;

            // Update current user data
            if (data.user) {
                currentUser = data.user;
                updateUserAvatar();
            }
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('Failed to update profile', 'error');
    }
}

function showSettings() {
    showUserProfile();
}

function showSecurityInfo() {
    showModal('security-modal');
}

// WebSocket Setup
function setupSocketListeners() {
    socket.on('friend_request', (data) => {
        showNotification(`New friend request from ${data.from}`);
        loadPendingRequests();
    });

    socket.on('chat_request', (data) => {
        showNotification(`New chat request from ${data.from}`);
        loadPendingRequests();
    });

    socket.on('friend_online', (data) => {
        showNotification(`${data.username} is now online`);
        loadFriends();
    });

    socket.on('friend_offline', (data) => {
        showNotification(`${data.username} is now offline`);
        loadFriends();
    });

    socket.on('new_message', async (data) => {
        if (activeChat && activeChat.id === data.chatId) {
            await loadChatMessages(activeChat.id);
        } else {
            showNotification(`New encrypted message from ${data.sender}`);
        }
        loadChats();
    });

    socket.on('chat_created', (data) => {
        showNotification(`New chat with ${data.with}`);
        loadChats();
    });

    socket.on('group_created', (data) => {
        showNotification(`Added to group: ${data.groupName}`);
        loadGroups();
    });

    socket.on('group_message', (data) => {
        if (activeChat && activeChat.id === data.chatId) {
            loadChatMessages(activeChat.id);
        } else {
            showNotification(`New message in ${data.groupName}`);
        }
        loadChats();
    });
}

// Close file options when clicking elsewhere
document.addEventListener('click', function(event) {
    const options = document.getElementById('file-options');
    const clipBtn = document.querySelector('.clip-btn');

    if (options && clipBtn && !options.contains(event.target) && !clipBtn.contains(event.target)) {
        options.style.display = 'none';
    }
});

// Initialize enhanced features
document.addEventListener('DOMContentLoaded', function() {
    createParticles();

    // Add GSAP animations to elements
    gsap.from('.logo-container', { duration: 1, y: -50, opacity: 0, delay: 0.2 });
    gsap.from('.auth-card', { duration: 1, y: 30, opacity: 0, delay: 0.5 });

    // Allow sending message with Enter key
    document.getElementById('message-text')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Mobile viewport height fix
    function setViewportHeight() {
        let vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }

    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', setViewportHeight);

    // Test encryption (uncomment to debug)
    // setTimeout(() => {
    //     if (currentUser) testEncryption();
    // }, 1000);
});

// Encryption test function
async function testEncryption() {
    console.log('Testing encryption...');
    const testKey = await deriveChatKey('user1', 'user2');
    const testMessage = "Test encryption works!";

    try {
        const encrypted = await encryptMessage(testMessage, testKey);
        const decrypted = await decryptMessage(encrypted, testKey);

        console.log('Encryption test:', {
            original: testMessage,
            decrypted: decrypted,
            success: testMessage === decrypted
        });

        return testMessage === decrypted;
    } catch (error) {
        console.error('Encryption test failed:', error);
        return false;
    }
}

