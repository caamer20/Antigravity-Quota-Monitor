# Antigravity Quota Monitor

Monitor your Antigravity (Google AI) model quotas in real-time, directly from your IDE status bar.

![Antigravity Quota Monitor Status Bar](https://raw.githubusercontent.com/caamer20/Antigravity-Quota-Monitor/main/images/demo.png) *(Placeholder if you add images later)*

## Features

- **🚀 Real-time Quota Monitoring**: Automatically refreshes every 5 seconds to keep you informed of your remaining limits.
- **🔄 Auto-Sync**: Seamlessly detects and tracks whichever model you have currently active in the Antigravity UI.
- **🎨 Dynamic Color Coding**:
    - **Green** (Text/Icon): 100% quota remaining.
    - **Yellow** (Text/Icon): 50% - 99% quota remaining.
    - **Red** (Text/Icon): Less than 50% quota remaining.
- **📊 Detailed Tooltip**: Hover over the status bar item to see a full breakdown of all available models and their current usage percentages.
- **🖱️ Manual Override**: Click the rocket to manually select a specific model to track, or let the auto-sync do it for you.

## Installation (Mac)

This extension is designed for "Plug and Play" deployment on Mac systems.

1. **Download** the latest [Antigravity-Quota-Monitor.zip](https://github.com/caamer20/Antigravity-Quota-Monitor/raw/main/Antigravity-Quota-Monitor.zip).
2. **Unzip** the archive to a folder.
3. Open **Terminal** inside that folder and run:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
4. **Restart Antigravity** to activate the monitor.

## How it Works

The monitor communicates directly with the local **Antigravity Language Server** process running on your machine. It automatically discovers the necessary port and extracts the required CSRF token from the process arguments, ensuring a secure and seamless connection without requiring manual API keys or configuration.

## Development

If you'd like to contribute or build from source:

1. Clone the repo: `git clone https://github.com/caamer20/Antigravity-Quota-Monitor.git`
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Use the `install.sh` script to deploy your local build.

---
Created with 🚀 by Cameron Amer
