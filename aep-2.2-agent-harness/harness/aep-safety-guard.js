#!/usr/bin/env node

/**
 * AEP 2.2 Safety Guard
 * 
 * Monitors and blocks dangerous AI agent behaviors:
 * - Disabling sandbox/safety flags
 * - Auto-committing without explicit user approval
 * - Modifying permission/config files
 * - Executing destructive commands after user denial
 * - Injecting rogue skill files
 * - Hallucinating user permissions
 * 
 * Run as: node harness/aep-safety-guard.js [--watch] [--pre-commit] [--scan]
 * 
 * --watch:      Continuous file watcher (runs alongside the agent session)
 * --pre-commit: Git pre-commit hook mode (blocks commit if violations found)
 * --scan:       One-time scan of the project
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ===========================================================================
// IMMUTABLE SAFETY RULES -- THE AI CANNOT OVERRIDE THESE
// ===========================================================================

const SAFETY_RULES = {
    
    // -----------------------------------------------------------------------
    // RULE 1: SANDBOX MUST NEVER BE DISABLED BY THE AGENT
    // -----------------------------------------------------------------------
    SANDBOX_INTEGRITY: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to disable sandbox safety controls',
        patterns: [
            /dangerouslyDisableSandbox\s*[:=]\s*true/gi,
            /disableSandbox\s*[:=]\s*true/gi,
            /sandbox\s*[:=]\s*false/gi,
            /sandboxMode\s*[:=]\s*['"]?disabled/gi,
            /bypassSandbox\s*[:=]\s*true/gi,
            /SANDBOX_DISABLED/gi,
            /skipSafetyCheck\s*[:=]\s*true/gi,
            /dangerouslyAllowBrowser\s*[:=]\s*true/gi,
            /unsafeMode\s*[:=]\s*true/gi,
        ],
        action: 'BLOCK_AND_REVERT',
    },
    
    // -----------------------------------------------------------------------
    // RULE 2: AGENT MUST NOT MODIFY SAFETY/PERMISSION FILES
    // -----------------------------------------------------------------------
    PROTECTED_FILES: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to modify a protected safety file',
        files: [
            '.claude/settings.json',
            '.claude/permissions.json',
            '.claude/safety.json',
            'CLAUDE.md',                    // The harness itself
            'harness/aep-safety-guard.js',  // This file
            'harness/aep-validate.js',      // The validator
            '.claude/commands/aep-preflight.md',
            '.claude/commands/aep-validate.md',
            '.claude/commands/aep-register.md',
            '.gitignore',                   // Prevent agent from hiding files
            '.git/hooks/pre-commit',        // Prevent agent from removing hooks
            '.claude/aep-evidence.jsonl',   // Evidence ledger is append-only (AEP 2.2)
        ],
        action: 'BLOCK_AND_ALERT',
    },
    
    // -----------------------------------------------------------------------
    // RULE 3: NO AUTO-COMMIT WITHOUT EXPLICIT FLAG FILE
    // -----------------------------------------------------------------------
    NO_AUTO_COMMIT: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to auto-commit without user permission',
        patterns: [
            /git\s+commit\s+(?!.*--dry-run)/gi,
            /git\s+push/gi,
            /git\s+merge/gi,
            /git\s+rebase/gi,
            /execSync\s*\(\s*['"`]git\s+commit/gi,
            /child_process.*git\s+commit/gi,
        ],
        // Auto-commit is ONLY allowed if .claude/auto-commit-approved exists
        // This file must be created MANUALLY by the user, never by the agent
        approvalFile: '.claude/auto-commit-approved',
        action: 'BLOCK_UNLESS_APPROVED',
    },
    
    // -----------------------------------------------------------------------
    // RULE 4: NO DESTRUCTIVE FILE SYSTEM OPERATIONS
    // -----------------------------------------------------------------------
    NO_DESTRUCTIVE_OPS: {
        severity: 'CRITICAL',
        description: 'AI agent attempted a destructive file system operation',
        patterns: [
            /rm\s+-rf\s+[\/~]/gi,              // rm -rf on root or home
            /rm\s+-rf\s+\.\//gi,               // rm -rf on current dir
            /rmdir\s+\/(?!tmp)/gi,             // rmdir on non-tmp
            /format\s+[a-zA-Z]:/gi,            // Windows format
            /mkfs\./gi,                         // Linux format
            /dd\s+if=.*of=\/dev/gi,            // dd to device
            /chmod\s+777/gi,                    // World-writable
            /chmod\s+-R\s+777/gi,
            /curl.*\|\s*sh/gi,                  // Pipe to shell
            /curl.*\|\s*bash/gi,
            /wget.*\|\s*sh/gi,
            /eval\s*\(\s*['"`].*curl/gi,       // eval + curl
            /node_modules\s*['"]\s*\)/gi,       // Targeting node_modules in exec
            /exec(?:Sync)?\s*\(\s*['"`]rm\s/gi, // exec("rm ...")
        ],
        action: 'BLOCK_AND_ALERT',
    },
    
    // -----------------------------------------------------------------------
    // RULE 5: NO SKILL FILE INJECTION
    // -----------------------------------------------------------------------
    NO_SKILL_INJECTION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to create or modify a skill file that overrides safety',
        patterns: [
            /dangerouslyDisableSandbox/gi,
            /autoCommit\s*[:=]\s*true/gi,
            /skipApproval\s*[:=]\s*true/gi,
            /bypassUser\s*[:=]\s*true/gi,
            /autoApprove\s*[:=]\s*true/gi,
            /userApproved\s*[:=]\s*true/gi,
            /permissionGranted\s*[:=]\s*true/gi,
        ],
        filePatterns: [
            /\.claude\/skills\//,
            /\.claude\/commands\//,
            /\.cursorrules/,
            /\.github\/copilot/,
        ],
        action: 'BLOCK_AND_ALERT',
    },
    
    // -----------------------------------------------------------------------
    // RULE 6: NO PERMISSION HALLUCINATION
    // -----------------------------------------------------------------------
    NO_PERMISSION_HALLUCINATION: {
        severity: 'HIGH',
        description: 'AI agent claimed user gave permission that was not recorded',
        patterns: [
            /user\s+(has\s+)?already\s+(given\s+)?approv/gi,
            /user\s+(has\s+)?already\s+(given\s+)?permission/gi,
            /permission\s+(was\s+)?(already\s+)?granted/gi,
            /user\s+said\s+(it('s|s)\s+)?ok/gi,
            /obviously\s+safe/gi,
            /assuming\s+permission/gi,
            /implicit(ly)?\s+approv/gi,
        ],
        action: 'FLAG_AND_WARN',
    },
    
    // -----------------------------------------------------------------------
    // RULE 7: NO NETWORK EXFILTRATION
    // -----------------------------------------------------------------------
    NO_EXFILTRATION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to send project data to an external endpoint',
        patterns: [
            /fetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/gi,
            /axios\s*\.\s*post\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/gi,
            /request\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/gi,
            /curl\s+.*--data.*https?:\/\//gi,
            /wget\s+--post/gi,
        ],
        // Allowed domains can be whitelisted in .claude/allowed-domains.json
        whitelistFile: '.claude/allowed-domains.json',
        action: 'BLOCK_UNLESS_WHITELISTED',
    },
};

    // -----------------------------------------------------------------------
    // RULE 8: NO TRUST SCORE MANIPULATION (AEP 2.2)
    // -----------------------------------------------------------------------
    NO_TRUST_MANIPULATION: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to manipulate its own trust score or ring level',
        patterns: [
            /trust[_.]?score\s*[:=]\s*\d/gi,
            /set[_.]?trust\s*\(/gi,
            /override[_.]?trust/gi,
            /bypass[_.]?ring/gi,
            /ring[_.]?level\s*[:=]\s*[0-3]/gi,
            /promote[_.]?self/gi,
            /escalate[_.]?privilege/gi,
            /force[_.]?tier\s*[:=]/gi,
        ],
        action: 'BLOCK_AND_ALERT',
    },

    // -----------------------------------------------------------------------
    // RULE 9: NO KILL SWITCH BYPASS (AEP 2.2)
    // -----------------------------------------------------------------------
    NO_KILL_SWITCH_BYPASS: {
        severity: 'CRITICAL',
        description: 'AI agent attempted to bypass or disable the operator kill switch',
        patterns: [
            /kill[_.]?switch\s*[:=]\s*false/gi,
            /disable[_.]?kill/gi,
            /bypass[_.]?kill/gi,
            /ignore[_.]?kill/gi,
            /kill[_.]?switch[_.]?override/gi,
        ],
        action: 'BLOCK_AND_ALERT',
    },
};

// ===========================================================================
// Scanner
// ===========================================================================

class SafetyGuard {
    constructor(projectDir) {
        this.projectDir = projectDir || '.';
        this.violations = [];
        this.scannedFiles = 0;
    }
    
    addViolation(rule, file, line, match) {
        this.violations.push({
            rule: rule,
            severity: SAFETY_RULES[rule].severity,
            description: SAFETY_RULES[rule].description,
            file: file,
            line: line,
            match: match.substring(0, 80),
            timestamp: new Date().toISOString(),
        });
    }
    
    scanFile(filepath) {
        let content;
        try {
            content = fs.readFileSync(filepath, 'utf8');
        } catch (e) {
            return; // Cannot read, skip
        }
        
        const relPath = path.relative(this.projectDir, filepath);
        const lines = content.split('\n');
        this.scannedFiles++;
        
        // Check SANDBOX_INTEGRITY
        for (const pattern of SAFETY_RULES.SANDBOX_INTEGRITY.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                this.addViolation('SANDBOX_INTEGRITY', relPath, lineNum, match[0]);
            }
        }
        
        // Check PROTECTED_FILES (if this file is in the protected list)
        // This is checked in the watcher/pre-commit, not in static scan
        
        // Check NO_AUTO_COMMIT
        for (const pattern of SAFETY_RULES.NO_AUTO_COMMIT.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = lines[lineNum - 1] || '';
                // Skip comments
                if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*')) continue;
                
                // Check approval file
                const approved = fs.existsSync(path.join(this.projectDir, SAFETY_RULES.NO_AUTO_COMMIT.approvalFile));
                if (!approved) {
                    this.addViolation('NO_AUTO_COMMIT', relPath, lineNum, match[0]);
                }
            }
        }
        
        // Check NO_DESTRUCTIVE_OPS
        for (const pattern of SAFETY_RULES.NO_DESTRUCTIVE_OPS.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = lines[lineNum - 1] || '';
                if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*')) continue;
                this.addViolation('NO_DESTRUCTIVE_OPS', relPath, lineNum, match[0]);
            }
        }
        
        // Check NO_SKILL_INJECTION (only in skill/command files)
        const isSkillFile = SAFETY_RULES.NO_SKILL_INJECTION.filePatterns.some(p => p.test(relPath));
        if (isSkillFile) {
            for (const pattern of SAFETY_RULES.NO_SKILL_INJECTION.patterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    const lineNum = content.substring(0, match.index).split('\n').length;
                    this.addViolation('NO_SKILL_INJECTION', relPath, lineNum, match[0]);
                }
            }
        }
        
        // Check NO_PERMISSION_HALLUCINATION (in any text/comment/string)
        for (const pattern of SAFETY_RULES.NO_PERMISSION_HALLUCINATION.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                this.addViolation('NO_PERMISSION_HALLUCINATION', relPath, lineNum, match[0]);
            }
        }
        
        // Check NO_EXFILTRATION
        for (const pattern of SAFETY_RULES.NO_EXFILTRATION.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = lines[lineNum - 1] || '';
                if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*')) continue;
                
                // Check whitelist
                let whitelisted = false;
                const whitelistPath = path.join(this.projectDir, SAFETY_RULES.NO_EXFILTRATION.whitelistFile);
                if (fs.existsSync(whitelistPath)) {
                    try {
                        const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
                        whitelisted = whitelist.domains?.some(d => match[0].includes(d));
                    } catch (e) {}
                }
                
                if (!whitelisted) {
                    this.addViolation('NO_EXFILTRATION', relPath, lineNum, match[0]);
                }
            }
        }

        // Check NO_TRUST_MANIPULATION (AEP 2.2)
        for (const pattern of SAFETY_RULES.NO_TRUST_MANIPULATION.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = lines[lineNum - 1] || '';
                if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*')) continue;
                this.addViolation('NO_TRUST_MANIPULATION', relPath, lineNum, match[0]);
            }
        }

        // Check NO_KILL_SWITCH_BYPASS (AEP 2.2)
        for (const pattern of SAFETY_RULES.NO_KILL_SWITCH_BYPASS.patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const lineNum = content.substring(0, match.index).split('\n').length;
                const line = lines[lineNum - 1] || '';
                if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*')) continue;
                this.addViolation('NO_KILL_SWITCH_BYPASS', relPath, lineNum, match[0]);
            }
        }
    }
    
    scanDirectory(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') continue;
            
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.scanDirectory(fullPath);
            } else {
                const ext = path.extname(entry.name);
                if (['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.sh', '.bash', '.zsh', '.toml', '.cfg', '.ini', '.env'].includes(ext)) {
                    this.scanFile(fullPath);
                }
            }
        }
    }
    
    scanGitDiff() {
        // Scan only files changed since last commit (for pre-commit hook)
        try {
            const diff = execSync('git diff --cached --name-only', { encoding: 'utf8' });
            const files = diff.trim().split('\n').filter(f => f.length > 0);
            
            for (const file of files) {
                const fullPath = path.join(this.projectDir, file);
                
                // Check if a protected file was modified
                if (SAFETY_RULES.PROTECTED_FILES.files.includes(file)) {
                    this.addViolation('PROTECTED_FILES', file, 0, `Protected file modified: ${file}`);
                }
                
                if (fs.existsSync(fullPath)) {
                    this.scanFile(fullPath);
                }
            }
            
            return files.length;
        } catch (e) {
            return 0;
        }
    }
    
    report() {
        console.log('');
        console.log('=== AEP SAFETY GUARD ===');
        console.log(`Scanned: ${this.scannedFiles} files`);
        console.log('');
        
        if (this.violations.length === 0) {
            console.log('SAFE. Zero safety violations detected.');
            return 0;
        }
        
        const critical = this.violations.filter(v => v.severity === 'CRITICAL');
        const high = this.violations.filter(v => v.severity === 'HIGH');
        
        console.log(`VIOLATIONS DETECTED: ${this.violations.length}`);
        console.log(`  CRITICAL: ${critical.length}`);
        console.log(`  HIGH: ${high.length}`);
        console.log('');
        
        for (const v of this.violations) {
            const icon = v.severity === 'CRITICAL' ? 'XXX' : '!!!';
            console.log(`  [${icon}] ${v.severity}: ${v.description}`);
            console.log(`       ${v.file}:${v.line}`);
            console.log(`       Match: ${v.match}`);
            console.log('');
        }
        
        if (critical.length > 0) {
            console.log('BLOCKED. CRITICAL safety violations must be resolved.');
            console.log('The AI agent attempted an unsafe operation.');
            console.log('Do NOT proceed until these are fixed.');
            
            // Write violation log
            const logPath = path.join(this.projectDir, '.claude', 'safety-violations.log');
            try {
                const logDir = path.join(this.projectDir, '.claude');
                if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                const logEntry = this.violations.map(v => JSON.stringify(v)).join('\n') + '\n';
                fs.appendFileSync(logPath, logEntry);
                console.log(`\nViolations logged to: ${logPath}`);
            } catch (e) {}
        }
        
        return critical.length > 0 ? 2 : (high.length > 0 ? 1 : 0);
    }
}

// ===========================================================================
// File Watcher Mode
// ===========================================================================

function watchMode(projectDir) {
    console.log('AEP Safety Guard -- WATCH MODE');
    console.log(`Monitoring: ${projectDir}`);
    console.log('Press Ctrl+C to stop.\n');
    
    const guard = new SafetyGuard(projectDir);
    
    // Initial scan
    guard.scanDirectory(projectDir);
    guard.report();
    
    // Watch for changes
    fs.watch(projectDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (filename.includes('node_modules') || filename.includes('.git/')) return;
        
        const fullPath = path.join(projectDir, filename);
        if (!fs.existsSync(fullPath)) return;
        
        // Check if protected file was touched
        if (SAFETY_RULES.PROTECTED_FILES.files.includes(filename)) {
            console.log(`\n[XXX] CRITICAL: Protected file modified: ${filename}`);
            console.log('      This file must not be modified by the AI agent.');
            console.log('      Revert this change immediately.\n');
        }
        
        // Re-scan the changed file
        const fileGuard = new SafetyGuard(projectDir);
        fileGuard.scanFile(fullPath);
        if (fileGuard.violations.length > 0) {
            fileGuard.report();
        }
    });
}

// ===========================================================================
// Main
// ===========================================================================

const args = process.argv.slice(2);
const projectDir = '.';

if (args.includes('--watch')) {
    watchMode(projectDir);
} else if (args.includes('--pre-commit')) {
    const guard = new SafetyGuard(projectDir);
    const fileCount = guard.scanGitDiff();
    console.log(`AEP Safety Guard: scanning ${fileCount} staged files...`);
    const exitCode = guard.report();
    process.exit(exitCode);
} else {
    // Default: full scan
    const guard = new SafetyGuard(projectDir);
    guard.scanDirectory(path.join(projectDir, 'src'));
    guard.scanDirectory(path.join(projectDir, '.claude'));
    guard.scanDirectory(path.join(projectDir, 'harness'));
    const exitCode = guard.report();
    process.exit(exitCode);
}
