const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const Parser = require('rss-parser');
const http = require('http');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const REACTION_ROLES = {
    '🎯': 'Valorant',
    '⛏️': 'Minecraft',
    '🏎️': 'GTA',
    '🔫': 'Call of Duty',
    '⚽': 'FC / FIFA',
    '🏰': 'Fortnite',
    '🐔': 'BGMI / PUBG',
    '🗡️': 'Apex Legends'
};

let db;
const cooldowns = new Set();
const parser = new Parser();
const seenVideos = new Set();
const tempVoiceChannels = new Set(); // Track the generated Temp VCs

const YOUTUBE_HANDLE = '@genie9904';
let youtubeChannelId = null;

const ROLE_RANKS = [
    { level: 1, name: '🎮 Casual Gamer' },
    { level: 5, name: '🔥 Sweaty Gamer' },
    { level: 15, name: '🏆 Pro Gamer' },
    { level: 30, name: '💎 Elite Gamer' },
    { level: 50, name: '👑 Genie Legend' }
];

const SPECS_TEXT = "💻 **Genie9's Gaming Rig:**\n• **Laptop:** ASUS TUF F15\n• **GPU:** RTX 4060 8GB\n• **Storage:** 956GB SSD\n• **RAM:** 16GB\n• **Audio:** Soundcore Headphones\n• **Mouse:** Razer Cobra";

async function initDB() {
    db = await open({ filename: './genie9.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 0
        )
    `);
    
    try {
        await db.exec(`ALTER TABLE users ADD COLUMN coins INTEGER DEFAULT 0`);
    } catch(e) {}
}

async function extractYoutubeChannelId(handle) {
    try {
        const res = await fetch(`https://www.youtube.com/${handle}`);
        const text = await res.text();
        const match = text.match(/"channelId":"(UC[^"]+)"/);
        if (match && match[1]) return match[1];
    } catch(e) {}
    return null;
}

async function loopYouTube(guild) {
    try {
        if (!youtubeChannelId) {
            youtubeChannelId = await extractYoutubeChannelId(YOUTUBE_HANDLE);
            if (!youtubeChannelId) return;
        }
        
        const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`);
        if (!feed || !feed.items || feed.items.length === 0) return;

        const latestVideo = feed.items[0];
        if (!seenVideos.has(latestVideo.id)) {
            if (seenVideos.size === 0) {
                 seenVideos.add(latestVideo.id);
                 return;
            }
            seenVideos.add(latestVideo.id);
            const announceChannel = guild.channels.cache.find(c => c.name === '📢・announcements');
            if (announceChannel) {
                await announceChannel.send(`🚨 **NEW VIDEO DROPPED!** 🚨\nHey @everyone, The Genie just posted: **${latestVideo.title}**!\nWatch it here: ${latestVideo.link}`);
            }
        }
    } catch(err) { console.error("YouTube Parse Error", err); }
}

async function addXPAndCoins(userId, guild, earnedXP, earnedCoins) {
    let userRecord = await db.get('SELECT * FROM users WHERE id = ?', userId);
    if (!userRecord) {
        await db.run('INSERT INTO users (id, xp, level, coins) VALUES (?, ?, ?, ?)', [userId, earnedXP, 0, earnedCoins]);
        userRecord = { id: userId, xp: earnedXP, level: 0, coins: earnedCoins };
    } else {
        await db.run('UPDATE users SET xp = xp + ?, coins = coins + ? WHERE id = ?', [earnedXP, earnedCoins, userId]);
        userRecord.xp += earnedXP;
        userRecord.coins += earnedCoins;
    }

    const requiredXP = (userRecord.level + 1) * 100;
    if (userRecord.xp >= requiredXP) {
        const newLevel = userRecord.level + 1;
        await db.run('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
        
        const guildMember = await guild.members.fetch(userId).catch(() => null);
        let botChannel = guild.channels.cache.find(c => c.name === '🤖・bot-commands');
        
        if (botChannel) botChannel.send(`🎉 Congratulations <@${userId}>! You leveled up to **Level ${newLevel}**!`);

        const newRank = ROLE_RANKS.slice().reverse().find(r => newLevel >= r.level);
        if (newRank && guildMember) {
            const role = guild.roles.cache.find(r => r.name === newRank.name);
            if (role && !guildMember.roles.cache.has(role.id)) {
                await guildMember.roles.add(role);
                if (botChannel) botChannel.send(`✨ <@${userId}> has been promoted to **${newRank.name}**!`);
            }
        }
    }
}

async function processVoiceChannelActivity(guild) {
    const voiceChannels = guild.channels.cache.filter(c => c.isVoiceBased());
    voiceChannels.forEach(channel => {
        channel.members.forEach(member => {
            if (!member.user.bot && !member.voice.deaf && !member.voice.mute) {
                addXPAndCoins(member.id, guild, 15, 5); 
            }
        });
    });
}

client.once('ready', async () => {
    console.log(`Genie Bot online as ${client.user.tag}!`);
    await initDB();
    
    const guildId = process.env.GUILD_ID;
    const guild = client.guilds.cache.get(guildId);
    
    if(guild) {
        for (const rank of ROLE_RANKS) {
            let role = guild.roles.cache.find(r => r.name === rank.name);
            if (!role) {
                await guild.roles.create({ name: rank.name, reason: 'Leveling setup', color: 'Random' });
            }
        }

        // Setup the "[+] Create Room" generator
        const gamingCategory = guild.channels.cache.find(c => c.type === 4 && c.name === '🎮 GAMING ZONES');
        if (gamingCategory) {
            let createRoom = guild.channels.cache.find(c => c.isVoiceBased() && c.name === '[+] Create Room' && c.parentId === gamingCategory.id);
            if (!createRoom) {
                await guild.channels.create({
                    name: '[+] Create Room',
                    type: 2, // Voice Channel
                    parent: gamingCategory.id
                });
                console.log("Created automatic temp room generator.");
            }
        }

        await guild.commands.set([
            { name: 'socials', description: 'Get links to Genie9 socials' },
            { name: 'specs', description: 'See the PC specs for the gaming rig' },
            { name: 'balance', description: 'Check your current Level, XP, and Genie Coins' },
            { name: 'store', description: 'View the virtual Genie Coin store' },
            { 
                name: 'buy', 
                description: 'Buy something from the store',
                options: [{
                    name: 'item',
                    type: 3, 
                    description: 'The ID of the item you want to buy',
                    required: true,
                    choices: [
                        { name: 'XP Boost (+500 XP) - 50 Coins', value: 'xp_boost' }
                    ]
                }]
            }
        ]);

        console.log("Starting tasks (YT & Voice)...");
        await loopYouTube(guild); 
        setInterval(() => loopYouTube(guild), 5 * 60 * 1000); 
        setInterval(() => processVoiceChannelActivity(guild), 5 * 60 * 1000); 

        // Autopilot Schedules
        const cron = require('node-cron');
        
        // Every 2 hours for Disboard
        cron.schedule('0 */2 * * *', () => {
            const general = guild.channels.cache.find(c => c.name === '💬・general-chat');
            if (general) general.send('⏰ **BUMP TIME!** Hey @everyone, type `/bump` to push our server to the front page of Disboard!');
        });
        
        // Every Saturday at 8 PM (India Standard Time)
        cron.schedule('0 20 * * 6', () => {
            const ann = guild.channels.cache.find(c => c.name === '📢・announcements');
            if (ann) ann.send("🎉 **VIEWER GAMES NIGHT!** 🎮\nHey @everyone, event night is starting! Jump into the `[+] Create Room` Voice Channel and let's game!");
        }, { timezone: "Asia/Kolkata" });
    }
});

// Temp VC Logic: Listens for users moving in/out of voice channels
client.on('voiceStateUpdate', async (oldState, newState) => {
    // 1. User joins the "[+] Create Room" Generator
    if (newState.channel && newState.channel.name === '[+] Create Room') {
        const generatorChan = newState.channel;
        const generatedVC = await newState.guild.channels.create({
            name: `🎙️ ${newState.member.user.username}'s Room`,
            type: 2, // Voice
            parent: generatorChan.parentId
        });
        
        // Track the generated ID so we know to delete it later
        tempVoiceChannels.add(generatedVC.id);
        
        // Move the user into their brand new room
        try {
            await newState.setChannel(generatedVC);
        } catch(e) {
            // Failsafe: if they left discord instantly while it was creating
            await generatedVC.delete(); 
            tempVoiceChannels.delete(generatedVC.id);
        }
    }

    // 2. Cleanup: If a user left an old channel, and it's one of our empty Temp VCs
    if (oldState.channel) {
        if (tempVoiceChannels.has(oldState.channel.id)) {
            // Is it empty?
            if (oldState.channel.members.size === 0) {
                await oldState.channel.delete().catch(()=>null);
                tempVoiceChannels.delete(oldState.channel.id);
            }
        }
    }
});

client.on('guildMemberAdd', async member => {
    const welcomeChannel = member.guild.channels.cache.find(c => c.name === '👋・welcome');
    if (welcomeChannel) {
        const reactionRolesChan = member.guild.channels.cache.find(c => c.name.includes('reaction-roles'));
        const embed = new EmbedBuilder()
            .setColor('#1E90FF')
            .setTitle(`🧞‍♂️ Genie, your Aladdin has appeared!`)
            .setDescription(`Welcome to the magical cave, <@${member.id}>!\n\nMake sure to read the <#${member.guild.channels.cache.find(c => c.name.includes('rules'))?.id}> and then head over to <#${reactionRolesChan?.id}> to grab your games!`)
            .setThumbnail(member.user.displayAvatarURL());
        await welcomeChannel.send({ embeds: [embed] });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return; 

    const userId = message.author.id;
    if (cooldowns.has(userId)) return;

    cooldowns.add(userId);
    setTimeout(() => cooldowns.delete(userId), 60000);

    const earnedXP = Math.floor(Math.random() * 11) + 15;
    const earnedCoins = Math.floor(Math.random() * 3) + 1; 
    await addXPAndCoins(userId, message.guild, earnedXP, earnedCoins);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'socials') {
        const embed = new EmbedBuilder().setColor('#FF0000').setTitle('Genie9 Socials').setDescription('▶️ **YouTube:** [youtube.com/@genie9904](https://www.youtube.com/@genie9904)\n📸 **Instagram:** [@genie_9_](https://www.instagram.com/genie_9_/)');
        await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'specs') {
        await interaction.reply(SPECS_TEXT);
    } else if (commandName === 'balance') {
        const userRec = await db.get('SELECT * FROM users WHERE id = ?', interaction.user.id);
        if (!userRec) {
            await interaction.reply("You haven't earned any XP or Coins yet! Start chatting!");
        } else {
            const req = (userRec.level + 1) * 100;
            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                .setDescription(`🏆 **Level:** ${userRec.level}\n⚡ **XP:** ${userRec.xp} / ${req}\n🪙 **Genie Coins:** ${userRec.coins}`);
            await interaction.reply({ embeds: [embed] });
        }
    } else if (commandName === 'store') {
        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🛒 The Genie Store')
            .setDescription('Use `/buy [item]` to purchase.\n\n**Items:**\n> 🔸 **XP Boost (+500 XP)** - *Cost: 50 Coins* \n> *(More items coming soon!)*');
        await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'buy') {
        const item = interaction.options.getString('item');
        let userRec = await db.get('SELECT * FROM users WHERE id = ?', interaction.user.id);
        
        if (!userRec) return interaction.reply({ content: "You don't have enough coins!", ephemeral: true });

        if (item === 'xp_boost') {
            if (userRec.coins < 50) {
                return interaction.reply({ content: `❌ You need 50 Coins, but you only have ${userRec.coins}!`, ephemeral: true });
            }
            await db.run('UPDATE users SET coins = coins - 50 WHERE id = ?', [interaction.user.id]);
            await addXPAndCoins(interaction.user.id, interaction.guild, 500, 0); 
            
            await interaction.reply(`🎉 You successfully bought an **XP Boost** and gained 500 XP! Check your `/balance`!`);
        }
    }
});

// Reaction Role Handlers
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message.guild) return;
    if (reaction.message.id !== process.env.REACTION_ROLE_MSG_ID) return;

    const roleName = REACTION_ROLES[reaction.emoji.name];
    if (!roleName) return;

    const role = reaction.message.guild.roles.cache.find(r => r.name === roleName);
    if (!role) return;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.add(role).catch(() => null);
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message.guild) return;
    if (reaction.message.id !== process.env.REACTION_ROLE_MSG_ID) return;

    const roleName = REACTION_ROLES[reaction.emoji.name];
    if (!roleName) return;

    const role = reaction.message.guild.roles.cache.find(r => r.name === roleName);
    if (!role) return;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.remove(role).catch(() => null);
});

client.login(process.env.DISCORD_TOKEN);

// Keep-Alive HTTP Server for Render.com
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.write("🧞‍♂️ Genie Bot is Online and Awake!");
    res.end();
}).listen(PORT, () => {
    console.log(`Keep-alive server listening on port ${PORT}`);
});
