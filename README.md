# Genie9 Discord Bot - Deployment Guide

This folder contains all the necessary source code for your custom Genie9 Discord Bot! 

## Hosting 24/7 (Free or Cheap)

If you turn off your PC, the bot goes offline. To keep it on 24/7, you should deploy this code to a cloud host.

**Recommended Hosts:**
* **Railway.app** (Very easy, just connect your GitHub repository and it hosts it automatically).
* **Render.com** (Also very easy and has a free tier).
* **VPS** (DigitalOcean or Linode - if you know how to use Linux).

## Deployment Steps

1. Upload these files to your Cloud Host (or link a GitHub repo containing these files).
2. **DO NOT** upload the `node_modules` folder (it's too big, the server will install them itself).
3. Make sure to upload the `genie9.sqlite` file if you want to keep the current XP and Levels! If you don't upload it, the bot will start everyone at Level 0.
4. **Environment Variables:** You MUST set your Secrets on the host's settings panel. Look for an "Environment Variables" or "Secrets" tab on your host and add:
   * `DISCORD_TOKEN` = `(Your private bot token)`
   * `GUILD_ID` = `(Your server ID)`

## Startup Command
Most hosts will automatically detect `package.json` and start the bot. If it asks you for a Start Command, use:
`node index.js`

Enjoy your new server!
