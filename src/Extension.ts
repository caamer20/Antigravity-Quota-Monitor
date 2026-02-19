import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as http from 'http';
import * as os from 'os';
import { promisify } from 'util';

const execPromise = promisify(exec);

interface ModelQuota {
    modelName: string;
    percentage: number; // 0-100
    resetTime?: string;
}

let statusBarItem: vscode.StatusBarItem;
let selectedModel = 'Gemini 3 Pro (High)'; // default
let lastKnownActiveModel: string | null = null; // tracks the API's active model for change detection
let modelsQuota: ModelQuota[] = [];
let outputChannel: vscode.OutputChannel;
let pollingInterval: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Antigravity Quota Watcher activated');
    outputChannel = vscode.window.createOutputChannel('Antigravity Quota');
    context.subscriptions.push(outputChannel);

    // Create status bar item (right side)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(rocket) ...';
    statusBarItem.tooltip = 'Fetching quota...';
    statusBarItem.command = 'antigravity-quota.selectModel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    const refreshCmd = vscode.commands.registerCommand('antigravity-quota.refresh', refreshQuota);
    const selectCmd = vscode.commands.registerCommand('antigravity-quota.selectModel', selectModel);
    context.subscriptions.push(refreshCmd, selectCmd);

    // Initial fetch
    refreshQuota();

    // Poll every 5 seconds
    pollingInterval = setInterval(refreshQuota, 5 * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(pollingInterval) });
}

function deactivate() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
}

async function refreshQuota() {
    try {
        // Only show loading indicator on the very first fetch
        // to avoid distracting flicker on subsequent polls
        if (modelsQuota.length === 0) {
            statusBarItem.text = '$(rocket) ...';
            statusBarItem.tooltip = 'Fetching quota...';
        }

        const { quotaMap, resetMap, activeModel } = await fetchAllQuota();
        modelsQuota = Array.from(quotaMap.entries()).map(([modelName, percentage]) => ({
            modelName,
            percentage,
            resetTime: resetMap.get(modelName)
        }));

        // Sync to the API's active model only when it changes
        // (i.e., the user switched models in the chat window)
        if (activeModel && activeModel !== lastKnownActiveModel) {
            selectedModel = activeModel;
        }
        // Always track the latest API active model
        if (activeModel) {
            lastKnownActiveModel = activeModel;
        }

        updateStatusBar();
    } catch (error) {
        console.error('Failed to refresh quota:', error);
        statusBarItem.text = '$(rocket) ?';
        statusBarItem.tooltip = 'Error fetching quota. Click to retry.';
        statusBarItem.backgroundColor = undefined;
    }
}

// Smoothly interpolate hex color: green(100%) → yellow(50%) → red(0%)
function quotaColor(pct: number): string {
    const green = { r: 74, g: 222, b: 128 };
    const yellow = { r: 250, g: 204, b: 21 };
    const red = { r: 248, g: 113, b: 113 };
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    let r: number, g: number, b: number;
    if (pct >= 50) {
        const t = (pct - 50) / 50; // 1.0 at 100%, 0.0 at 50%
        r = lerp(yellow.r, green.r, t);
        g = lerp(yellow.g, green.g, t);
        b = lerp(yellow.b, green.b, t);
    } else {
        const t = pct / 50;         // 1.0 at 50%, 0.0 at 0%
        r = lerp(red.r, yellow.r, t);
        g = lerp(red.g, yellow.g, t);
        b = lerp(red.b, yellow.b, t);
    }
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Format an ISO/Unix timestamp as MM/DD/YYYY
function formatResetDate(resetTime: string | undefined): string {
    if (!resetTime) { return ''; }
    try {
        const d = new Date(resetTime);
        if (isNaN(d.getTime())) { return ''; }
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    } catch { return ''; }
}

function updateStatusBar() {
    const model = modelsQuota.find(m => m.modelName === selectedModel);
    if (!model) {
        statusBarItem.text = '$(rocket) N/A';
        statusBarItem.tooltip = 'Selected model not found';
        statusBarItem.backgroundColor = undefined;
        return;
    }

    const pct = model.percentage;
    const color = quotaColor(pct);
    const resetLabel = formatResetDate(model.resetTime);
    statusBarItem.text = resetLabel
        ? `$(rocket) ${selectedModel}  ${pct}%  R ${resetLabel}`
        : `$(rocket) ${selectedModel}  ${pct}%`;

    // Build hover tooltip with smooth-colored solid dots
    const rows = modelsQuota.map(m => {
        const c = quotaColor(m.percentage);
        const reset = formatResetDate(m.resetTime);
        const resetStr = reset ? `  <span style="color:#888;">R ${reset}</span>` : '';
        return `<span style="color:${c};">●</span>&nbsp;&nbsp;**${m.modelName}**: ${m.percentage}%${resetStr}`;
    }).join('\n\n');

    const md = new vscode.MarkdownString(rows);
    md.supportHtml = true;
    md.isTrusted = true;
    statusBarItem.tooltip = md;

    // Apply interpolated color directly as a hex string
    statusBarItem.color = color;
    statusBarItem.backgroundColor = undefined;
}

async function selectModel() {
    if (modelsQuota.length === 0) {
        vscode.window.showInformationMessage('No quota data available yet. Try refreshing.');
        return;
    }

    const items = modelsQuota.map(m => ({
        label: m.modelName,
        description: `${m.percentage}% remaining`,
        picked: m.modelName === selectedModel
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a model to display in status bar',
        canPickMany: false
    });

    if (selected) {
        selectedModel = selected.label;
        updateStatusBar();
    }
}

// ----------------------------------------------------------------------
// OS-specific discovery and fetching
// ----------------------------------------------------------------------

async function fetchAllQuota(): Promise<{ quotaMap: Map<string, number>; resetMap: Map<string, string>; activeModel: string | null }> {
    const platform = os.platform();
    const pid = await getLanguageServerPID();
    if (!pid) {
        throw new Error('Could not find Antigravity Language Server process');
    }

    const csrfToken = await getCsrfToken(pid);
    if (!csrfToken) {
        throw new Error('Could not extract CSRF token from process command line');
    }

    const ports = await getListeningPorts(pid);
    if (ports.length === 0) {
        throw new Error('No listening ports found for language server');
    }

    // Try each port until one succeeds
    for (const port of ports) {
        try {
            const data = await queryPort(port, csrfToken);
            const configData = data?.userStatus?.cascadeModelConfigData;
            const models = configData?.clientModelConfigs || data?.models;

            if (models && Array.isArray(models)) {
                const quotaMap = new Map<string, number>();
                const resetMap = new Map<string, string>();
                // Build a map of model ID -> label for active model lookup
                const idToLabel = new Map<string, string>();

                for (const model of models) {
                    const fraction = model.quotaInfo?.remainingFraction;
                    const name = model.label || model.modelName || 'Unknown Model';
                    outputChannel.appendLine(`[Quota] ${name}: remainingFraction=${fraction}, raw quotaInfo=${JSON.stringify(model.quotaInfo)}`);
                    if (typeof fraction === 'number') {
                        const pct = Math.round(fraction * 100);
                        if (name && !quotaMap.has(name)) {
                            quotaMap.set(name, pct);
                            // Also store the reset time if available
                            const rt = model.quotaInfo?.resetTime;
                            if (rt) { resetMap.set(name, rt); }
                        }
                    }
                    // Track ID -> label regardless of quota
                    const modelId = model.modelOrAlias?.model;
                    const label = model.label || model.modelName;
                    if (modelId && label) {
                        idToLabel.set(modelId, label);
                    }
                }

                if (quotaMap.size > 0) {
                    // Detect the currently active model in Antigravity
                    const activeModelId = configData?.defaultOverrideModelConfig?.modelOrAlias?.model;
                    const activeModel = activeModelId ? (idToLabel.get(activeModelId) ?? null) : null;
                    return { quotaMap, resetMap, activeModel };
                }
            }
        } catch (err) {
            console.warn(`Port ${port} failed:`, err);
        }
    }
    throw new Error('All ports failed to return valid quota data');
}

// Get PID of language_server process
async function getLanguageServerPID(): Promise<number | null> {
    const platform = os.platform();
    if (platform === 'win32') {
        // Windows: use wmic
        try {
            const { stdout } = await execPromise(
                'wmic process where "name like \'%language_server%\'" get ProcessId /format:csv'
            );
            const lines = stdout.trim().split('\n').slice(1); // skip header
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const pid = parseInt(parts[1].trim(), 10);
                    if (!isNaN(pid)) return pid;
                }
            }
        } catch { /* ignore */ }
        // Fallback: tasklist
        try {
            const { stdout } = await execPromise('tasklist /fi "imagename eq language_server.exe" /fo csv /nh');
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const match = line.match(/"([^"]+)","(\d+)"/);
                if (match) {
                    const pid = parseInt(match[2], 10);
                    if (!isNaN(pid)) return pid;
                }
            }
        } catch { /* ignore */ }
    } else {
        // macOS/Linux: pgrep or ps
        try {
            const { stdout } = await execPromise('pgrep -f language_server');
            const pid = parseInt(stdout.trim(), 10);
            if (!isNaN(pid)) return pid;
        } catch { /* pgrep not available or not found */ }

        try {
            const { stdout } = await execPromise('ps aux | grep language_server | grep -v grep');
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const pid = parseInt(parts[1], 10);
                    if (!isNaN(pid)) return pid;
                }
            }
        } catch { /* ignore */ }
    }
    return null;
}

// Extract CSRF token from process command line
async function getCsrfToken(pid: number): Promise<string | null> {
    const platform = os.platform();
    let cmdline = '';
    try {
        if (platform === 'win32') {
            const { stdout } = await execPromise(
                `wmic process where processid=${pid} get commandline /format:csv`
            );
            const lines = stdout.trim().split('\n');
            // Format: "Node,CommandLine"
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    cmdline = parts[1].trim();
                    break;
                }
            }
        } else if (platform === 'darwin') {
            const { stdout } = await execPromise(`ps -p ${pid} -o command=`);
            cmdline = stdout.trim();
        } else {
            // Linux
            const { stdout } = await execPromise(`cat /proc/${pid}/cmdline | tr '\\0' ' '`);
            cmdline = stdout.trim();
        }
    } catch (err) {
        console.error('Failed to get command line:', err);
        return null;
    }

    // Look for common patterns: --csrf-token=xxx or --csrf-token xxx
    const tokenMatch = cmdline.match(/--csrf-token[= ](\S+)/) ||
        cmdline.match(/--csrf_token[= ](\S+)/) ||
        cmdline.match(/-csrf-token[= ](\S+)/);
    if (tokenMatch) {
        return tokenMatch[1];
    }
    return null;
}

// Get listening ports for the given PID
async function getListeningPorts(pid: number): Promise<number[]> {
    const platform = os.platform();
    const ports: number[] = [];

    if (platform === 'win32') {
        // Use PowerShell for reliable port extraction
        try {
            const { stdout } = await execPromise(
                `powershell -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -eq ${pid} } | Select-Object -ExpandProperty LocalPort"`
            );
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const port = parseInt(line.trim(), 10);
                if (!isNaN(port)) ports.push(port);
            }
        } catch { /* ignore */ }

        // Fallback to netstat
        if (ports.length === 0) {
            try {
                const { stdout } = await execPromise('netstat -ano');
                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (line.includes('LISTENING') && line.includes(pid.toString())) {
                        const match = line.match(/:(\d+)/);
                        if (match) {
                            const port = parseInt(match[1], 10);
                            if (!isNaN(port)) ports.push(port);
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    } else {
        // macOS/Linux: lsof
        try {
            const { stdout } = await execPromise(`lsof -nP -p ${pid} | grep LISTEN`);
            const lines = stdout.split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                // Look for "TCP *:port (LISTEN)" or similar
                for (const part of parts) {
                    const match = part.match(/:(\d+)$/);
                    if (match) {
                        const port = parseInt(match[1], 10);
                        if (!isNaN(port)) ports.push(port);
                        break;
                    }
                }
            }
        } catch { /* ignore */ }
    }

    // Remove duplicates and sort
    return [...new Set(ports)].sort((a, b) => a - b);
}

// Query a specific port for quota data
function queryPort(port: number, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Codeium-Csrf-Token': token,
                'Connect-Protocol-Version': '1'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                locale: 'en'
            }
        }));
        req.end();
    });
}
